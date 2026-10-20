import { randomBytes } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { PolicyService } from '../authz/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { HuddleService } from '../realtime/huddle.service';
import { HuddleMediaHooks } from '../realtime/huddle-media-hooks';
import { roomForChannel, roomForConversation } from '../realtime/realtime.service';
import {
  egressEnabled,
  listParticipantIdentities,
  livekitConfig,
  parseSfuRoomName,
  removeParticipant,
  sfuRoomName,
  signLivekitToken,
  userIdOfIdentity,
} from './livekit-api';

/** Join tokens only need to outlive the connect; LiveKit refreshes them for connected clients. */
const TOKEN_TTL_SECONDS = 10 * 60;

/**
 * Huddles through a self-hosted LiveKit SFU (instead of the peer-to-peer mesh,
 * which caps out around 5–6 people). Enabled when LIVEKIT_URL /
 * LIVEKIT_API_KEY / LIVEKIT_API_SECRET are set; otherwise clients use the mesh.
 *
 * The Socket.IO gateway stays the source of truth for who is in a huddle; this
 * service mirrors it onto the media server:
 *  - a token is only minted for someone actually admitted to the huddle (so the
 *    waiting room and lock hold), for the room the server assigns — the main
 *    room or their breakout room, each a separate LiveKit room;
 *  - leaving, being removed, and breakout moves kick stale connections, and
 *    the participant_joined webhook re-checks every connection.
 */
@Injectable()
export class SfuService implements OnModuleInit {
  private readonly logger = new Logger(SfuService.name);
  /** huddle key → LiveKit rooms we've issued tokens for (main + breakouts). */
  private readonly knownRooms = new Map<string, Set<string>>();

  constructor(
    private readonly policy: PolicyService,
    private readonly prisma: PrismaService,
    private readonly huddle: HuddleService,
    private readonly hooks: HuddleMediaHooks,
  ) {}

  onModuleInit() {
    this.hooks.register({
      memberLeft: (key, userId, removed) => this.onMemberLeft(key, userId, removed),
      breakoutsChanged: (key) => this.enforce(key),
      huddleEnded: (key) => {
        this.knownRooms.delete(key);
      },
    });
  }

  get enabled(): boolean {
    return livekitConfig() !== null;
  }

  status() {
    return { enabled: this.enabled, recording: egressEnabled() };
  }

  async tokenFor(
    userId: string,
    body: { channelId?: string; conversationId?: string },
  ): Promise<{ url: string; token: string; room: string }> {
    const cfg = livekitConfig();
    if (!cfg) throw new ServiceUnavailableException('SFU is not configured');

    let key: string;
    if (body?.channelId) {
      await this.policy.requireChannelMember(userId, body.channelId);
      key = roomForChannel(body.channelId);
    } else if (body?.conversationId) {
      await this.policy.requireConversationMember(userId, body.conversationId);
      key = roomForConversation(body.conversationId);
    } else {
      throw new BadRequestException('channelId or conversationId required');
    }
    // Admission is the gateway's call (waiting room, lock): no media before it.
    if (!this.huddle.isPresent(key, userId)) throw new ForbiddenException('Join the huddle first');

    const room = sfuRoomName(key, this.huddle.breakoutOf(key, userId));
    this.remember(key, room);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    const token = signLivekitToken(cfg, {
      // A per-connection suffix so a second tab doesn't kick the first.
      identity: `${userId}~${randomBytes(6).toString('base64url')}`,
      name: user.displayName,
      ttlSeconds: TOKEN_TTL_SECONDS,
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false },
    });
    return { url: cfg.url, token, room };
  }

  /** Is this connection allowed in this LiveKit room right now? */
  allowed(room: string, identity: string): boolean {
    const parsed = parseSfuRoomName(room);
    if (!parsed) return false;
    const userId = userIdOfIdentity(identity);
    if (!this.huddle.isPresent(parsed.key, userId)) return false;
    return sfuRoomName(parsed.key, this.huddle.breakoutOf(parsed.key, userId)) === room;
  }

  /** Webhook: someone connected — throw them out if they shouldn't be there. */
  async checkJoin(room: string, identity: string): Promise<void> {
    const cfg = livekitConfig();
    if (!cfg) return;
    const parsed = parseSfuRoomName(room);
    if (parsed) this.remember(parsed.key, room);
    if (this.allowed(room, identity)) return;
    await removeParticipant(cfg, room, identity);
    this.logger.log(`Removed ${identity} from ${room} (not admitted there)`);
  }

  private remember(key: string, room: string) {
    let rooms = this.knownRooms.get(key);
    if (!rooms) {
      rooms = new Set();
      this.knownRooms.set(key, rooms);
    }
    rooms.add(room);
  }

  /** Every LiveKit room this huddle may have: issued tokens + current breakouts. */
  private roomsOf(key: string): string[] {
    const rooms = new Set(this.knownRooms.get(key) ?? []);
    rooms.add(key);
    for (const r of this.huddle.getBreakouts(key).rooms) rooms.add(sfuRoomName(key, r.id));
    return [...rooms];
  }

  private async onMemberLeft(key: string, userId: string, removed: boolean) {
    const cfg = livekitConfig();
    if (!cfg) return;
    // A dropped socket that already came back (same user, re-joined) keeps its media.
    if (!removed && this.huddle.isPresent(key, userId)) return;
    for (const room of this.roomsOf(key)) {
      for (const identity of await listParticipantIdentities(cfg, room)) {
        if (userIdOfIdentity(identity) === userId) await removeParticipant(cfg, room, identity);
      }
    }
  }

  /** Kick every connection that's in a room it's no longer assigned to. */
  async enforce(key: string): Promise<void> {
    const cfg = livekitConfig();
    if (!cfg) return;
    for (const room of this.roomsOf(key)) {
      for (const identity of await listParticipantIdentities(cfg, room)) {
        if (!this.allowed(room, identity)) await removeParticipant(cfg, room, identity);
      }
    }
  }
}

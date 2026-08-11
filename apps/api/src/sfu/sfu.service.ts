import { createHmac } from 'crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PolicyService } from '../authz/policy.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Mints LiveKit access tokens so huddles can optionally run through a
 * self-hosted SFU instead of the peer-to-peer mesh (which caps out ~5–6
 * participants). A LiveKit access token is just an HS256 JWT with a `video`
 * grant, so we sign it with Node crypto — no SDK dependency.
 *
 * Enabled only when LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are set;
 * otherwise the endpoint reports "disabled" and clients fall back to the mesh.
 */
@Injectable()
export class SfuService {
  constructor(
    private readonly policy: PolicyService,
    private readonly prisma: PrismaService,
  ) {}

  private config() {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) return null;
    return { url, apiKey, apiSecret };
  }

  get enabled(): boolean {
    return this.config() !== null;
  }

  private base64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
  }

  /** Sign a LiveKit-compatible HS256 JWT with a room-join grant. */
  private signToken(identity: string, name: string, room: string): string {
    const { apiKey, apiSecret } = this.config()!;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      iss: apiKey,
      sub: identity,
      name,
      nbf: now,
      exp: now + 60 * 60, // 1h
      // LiveKit VideoGrant
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true },
    };
    const encHeader = this.base64url(JSON.stringify(header));
    const encPayload = this.base64url(JSON.stringify(payload));
    const data = `${encHeader}.${encPayload}`;
    const sig = createHmac('sha256', apiSecret).update(data).digest('base64url');
    return `${data}.${sig}`;
  }

  async tokenFor(
    userId: string,
    body: { channelId?: string; conversationId?: string },
  ): Promise<{ url: string; token: string; room: string }> {
    const cfg = this.config();
    if (!cfg) throw new ServiceUnavailableException('SFU is not configured');

    let room: string;
    if (body.channelId) {
      await this.policy.requireChannelMember(userId, body.channelId);
      room = `channel:${body.channelId}`;
    } else if (body.conversationId) {
      await this.policy.requireConversationMember(userId, body.conversationId);
      room = `conversation:${body.conversationId}`;
    } else {
      throw new ServiceUnavailableException('channelId or conversationId required');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    return { url: cfg.url, token: this.signToken(userId, user.displayName, room), room };
  }
}

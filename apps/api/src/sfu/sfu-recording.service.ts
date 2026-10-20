import { createHash, randomUUID } from 'crypto';
import * as path from 'path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SOCKET_EVENTS, type HuddleSettings } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MessagesService, channelContainer, conversationContainer } from '../messages/messages.service';
import { HuddleService } from '../realtime/huddle.service';
import { HuddleMediaHooks } from '../realtime/huddle-media-hooks';
import { RealtimeService } from '../realtime/realtime.service';
import { MAX_INT_SIZE } from '../attachments/attachments.controller';
import { egressEnabled, livekitConfig, startRoomCompositeEgress, stopEgress, type EgressOutput } from './livekit-api';

/** EgressStatus, by name and by number (LiveKit may send either). */
const SUCCESS = new Set(['EGRESS_COMPLETE', 'EGRESS_LIMIT_REACHED', '3', '6']);

export interface EgressEndedInfo {
  egressId: string;
  status: string;
  error?: string;
  /** Bytes, when LiveKit reports it. */
  size?: number;
  /** Milliseconds, when LiveKit reports it. */
  durationMs?: number;
}

/** Normalise LiveKit's EgressInfo JSON (camelCase or snake_case, numbers or strings). */
export function parseEgressInfo(raw: unknown): EgressEndedInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const egressId = (e.egressId ?? e.egress_id) as string | undefined;
  if (!egressId) return null;
  const results = (e.fileResults ?? e.file_results ?? (e.file ? [e.file] : [])) as Record<string, unknown>[];
  const file = Array.isArray(results) ? results[0] : undefined;
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  const size = num(file?.size);
  const durationNs = num(file?.duration);
  return {
    egressId,
    status: String(e.status ?? ''),
    error: typeof e.error === 'string' && e.error ? e.error : undefined,
    size: size !== undefined && Number.isFinite(size) ? size : undefined,
    durationMs: durationNs !== undefined && Number.isFinite(durationNs) ? Math.round(durationNs / 1e6) : undefined,
  };
}

/** A stable UUID for a recording's message, so a redelivered webhook never posts twice. */
export function messageIdFor(recordingId: string): string {
  const h = createHash('sha256').update(`huddle-recording:${recordingId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Server-side huddle recording through LiveKit Egress (room composite → MP4).
 * Opt-in with LIVEKIT_EGRESS=1 on top of the SFU, and only meaningful with an
 * Egress worker running next to LiveKit. The file is written straight into
 * our storage (the S3 bucket, or the uploads folder for the disk driver),
 * then posted to the huddle's channel/DM as the person who started it when
 * LiveKit's egress_ended webhook arrives.
 */
@Injectable()
export class SfuRecordingService implements OnModuleInit {
  private readonly logger = new Logger(SfuRecordingService.name);
  /** Starts in flight per huddle, so a quick stop waits for the egress id. */
  private readonly starting = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly messages: MessagesService,
    private readonly huddle: HuddleService,
    private readonly hooks: HuddleMediaHooks,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.hooks.register({
      recordingChanged: (key, settings) => this.onRecordingChanged(key, settings),
      huddleEnded: (key) => this.stopActive(key),
    });
  }

  private async onRecordingChanged(key: string, settings: HuddleSettings) {
    if (settings.recordingBy && settings.recordingOnServer) await this.start(key, settings.recordingBy);
    else await this.stopActive(key);
  }

  private output(storageKey: string): EgressOutput {
    if ((process.env.STORAGE_DRIVER ?? 'disk') === 's3') {
      return {
        kind: 's3',
        bucket: process.env.S3_BUCKET ?? '',
        region: process.env.S3_REGION ?? 'us-east-1',
        accessKey: process.env.S3_ACCESS_KEY_ID ?? '',
        secret: process.env.S3_SECRET_ACCESS_KEY ?? '',
        endpoint: process.env.S3_ENDPOINT || undefined,
        filepath: storageKey,
      };
    }
    // Disk driver: the egress worker must see our uploads folder (same host or a
    // shared volume); LIVEKIT_EGRESS_FILE_DIR is that folder as the worker sees it.
    const dir = process.env.LIVEKIT_EGRESS_FILE_DIR || path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');
    return { kind: 'file', filepath: `${dir.replace(/[\\/]+$/, '')}/${storageKey}` };
  }

  async start(key: string, userId: string): Promise<void> {
    const cfg = livekitConfig();
    if (!cfg || !egressEnabled()) return this.abandon(key, userId);
    if (this.starting.has(key)) return this.starting.get(key);
    const run = (async () => {
      const active = await this.prisma.huddleRecording.findFirst({ where: { huddleKey: key, status: 'ACTIVE' } });
      if (active) return;
      const storageKey = randomUUID();
      try {
        const egressId = await startRoomCompositeEgress(cfg, key, this.output(storageKey));
        await this.prisma.huddleRecording.create({ data: { egressId, huddleKey: key, startedById: userId, storageKey } });
        this.logger.log(`Recording ${key} on the server (egress ${egressId})`);
      } catch (err) {
        this.logger.warn(`Couldn't start a server recording of ${key}: ${String(err)}`);
        this.abandon(key, userId);
      }
    })();
    this.starting.set(key, run);
    try {
      await run;
    } finally {
      this.starting.delete(key);
    }
  }

  /** Stop every running egress of this huddle. */
  async stopActive(key: string): Promise<void> {
    await this.starting.get(key);
    const cfg = livekitConfig();
    if (!cfg) return;
    const rows = await this.prisma.huddleRecording.findMany({ where: { huddleKey: key, status: 'ACTIVE' } });
    for (const row of rows) {
      const claimed = await this.prisma.huddleRecording.updateMany({
        where: { id: row.id, status: 'ACTIVE' },
        data: { status: 'STOPPING' },
      });
      if (claimed.count === 0) continue;
      try {
        await stopEgress(cfg, row.egressId);
      } catch (err) {
        this.logger.warn(`Couldn't stop egress ${row.egressId}: ${String(err)}`);
      }
    }
  }

  /** The recording can't run: clear the indicator so nobody believes they're recorded. */
  private abandon(key: string, userId: string) {
    const s = this.huddle.getSettings(key);
    if (s.recordingBy !== userId || !s.recordingOnServer) return;
    this.huddle.setRecording(key, null);
    this.broadcastSettings(key);
  }

  private broadcastSettings(key: string) {
    const settings = this.huddle.getSettings(key);
    if (key.startsWith('channel:')) {
      const channelId = key.slice('channel:'.length);
      this.realtime.emitToChannel(channelId, SOCKET_EVENTS.HUDDLE_SETTINGS, { channelId, ...settings });
    } else {
      const conversationId = key.slice('conversation:'.length);
      this.realtime.emitToConversation(conversationId, SOCKET_EVENTS.HUDDLE_SETTINGS, { conversationId, ...settings });
    }
  }

  /** egress_ended webhook: attach the file and post it, exactly once. */
  async finish(info: EgressEndedInfo): Promise<void> {
    const row = await this.prisma.huddleRecording.findUnique({ where: { egressId: info.egressId } });
    if (!row) return; // not one of ours
    const ok = SUCCESS.has(info.status);
    const claimed = await this.prisma.huddleRecording.updateMany({
      where: { id: row.id, status: { in: ['ACTIVE', 'STOPPING'] } },
      data: { status: ok ? 'COMPLETE' : 'FAILED', endedAt: new Date(), error: ok ? null : (info.error ?? info.status) },
    });
    if (claimed.count === 0) return; // already handled (webhook retry)

    // The egress ended on its own (room closed, limit, failure) while the huddle
    // still shows it recording: take the indicator down.
    const s = this.huddle.getSettings(row.huddleKey);
    if (s.recordingOnServer && s.recordingBy === row.startedById) {
      this.huddle.setRecording(row.huddleKey, null);
      this.broadcastSettings(row.huddleKey);
    }

    if (!ok) {
      this.logger.warn(`Server recording ${row.egressId} failed: ${info.error ?? info.status}`);
      return;
    }
    // The stored object's real size (downloads send it as Content-Length).
    const size = await this.storage.size(row.storageKey);
    if (size === null) {
      await this.prisma.huddleRecording.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: 'Recording file not found in storage' },
      });
      this.logger.warn(`Server recording ${row.egressId} finished but ${row.storageKey} isn't in storage`);
      return;
    }

    const container = row.huddleKey.startsWith('channel:')
      ? channelContainer(row.huddleKey.slice('channel:'.length))
      : conversationContainer(row.huddleKey.slice('conversation:'.length));
    const durationMs = info.durationMs ?? Date.now() - row.startedAt.getTime();
    const stamp = row.startedAt.toISOString().slice(0, 16).replace(/[T:]/g, '-');
    try {
      const attachment = await this.prisma.attachment.create({
        data: {
          uploaderId: row.startedById,
          filename: `huddle-recording-${stamp}.mp4`,
          mimeType: 'video/mp4',
          sizeBytes: Math.min(size, MAX_INT_SIZE),
          storageKey: row.storageKey,
        },
      });
      const text = `🔴 Huddle recording · ${formatDuration(durationMs)}`;
      const message = await this.messages.send(row.startedById, container, {
        clientMsgId: messageIdFor(row.id),
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
        contentText: text,
        attachmentIds: [attachment.id],
      });
      await this.prisma.huddleRecording.update({ where: { id: row.id }, data: { messageId: message.id } });
    } catch (err) {
      // E.g. the starter lost access meanwhile. The file stays in storage, referenced by the row.
      this.logger.warn(`Couldn't post server recording ${row.egressId}: ${String(err)}`);
      await this.prisma.huddleRecording.update({
        where: { id: row.id },
        data: { error: `Not posted: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500) },
      });
    }
  }
}

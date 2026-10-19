import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { HuddleService, type HuddleSnapshot } from './huddle.service';

const PREFIX = 'huddle:snap:';
/** How long a snapshot waits for people to come back after a restart. */
const TTL_SECONDS = 10 * 60;
const FLUSH_MS = 5000;

/**
 * Makes live huddles survive an API restart or deploy. HuddleService keeps
 * meeting state in memory; this writes a snapshot of every active room to Redis
 * every few seconds (only when it changed) and once more on graceful shutdown.
 * Clients already re-join automatically after a reconnect, and the gateway
 * restores the room from its snapshot on the first re-join — so notes, polls,
 * whiteboard, annotations, roles, settings, breakouts and the transcript carry on.
 *
 * Disabled in tests (DISABLE_SYNC_QUEUE=1), matching the queues.
 * Scope: one API instance at a time (a deploy/restart), not active-active —
 * two live instances would still each hold their own copy of a room.
 */
@Injectable()
export class HuddlePersistenceService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(HuddlePersistenceService.name);
  private redis: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** key -> last JSON written, to skip unchanged rooms. */
  private readonly written = new Map<string, string>();

  constructor(private readonly huddle: HuddleService) {}

  get enabled(): boolean {
    return this.redis !== null;
  }

  onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return;
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
    this.redis.on('error', (err) => this.logger.warn(`Redis: ${err.message}`));
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.redis?.quit().catch(() => undefined);
    this.redis = null;
  }

  /** Write every changed active room. Returns how many were written. */
  async flush(): Promise<number> {
    if (!this.redis) return 0;
    let n = 0;
    for (const key of this.huddle.activeKeys()) {
      const snap = this.huddle.snapshot(key);
      if (!snap) continue;
      const json = JSON.stringify(snap);
      try {
        if (this.written.get(key) === json) {
          // Unchanged: just keep it from expiring while the meeting runs.
          await this.redis.expire(PREFIX + key, TTL_SECONDS);
          continue;
        }
        await this.redis.set(PREFIX + key, json, 'EX', TTL_SECONDS);
        if (!this.huddle.hasRoom(key)) {
          // The meeting ended while we were writing — don't leave a stale snapshot
          // that a later, unrelated huddle in this channel would restore.
          await this.remove(key);
          continue;
        }
        this.written.set(key, json);
        n++;
      } catch (err) {
        this.logger.warn(`Snapshot of ${key} failed: ${String(err)}`);
      }
    }
    return n;
  }

  async load(key: string): Promise<HuddleSnapshot | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(PREFIX + key);
      return raw ? (JSON.parse(raw) as HuddleSnapshot) : null;
    } catch (err) {
      this.logger.warn(`Loading snapshot of ${key} failed: ${String(err)}`);
      return null;
    }
  }

  /** The meeting ended normally — nothing to restore. */
  async remove(key: string): Promise<void> {
    this.written.delete(key);
    await this.redis?.del(PREFIX + key).catch(() => undefined);
  }

  /** Snapshots whose meeting nobody has re-joined on this instance. */
  async orphanKeys(): Promise<string[]> {
    if (!this.redis) return [];
    const out: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 100);
      cursor = next;
      for (const k of keys) {
        const key = k.slice(PREFIX.length);
        if (!this.huddle.hasRoom(key)) out.push(key);
      }
    } while (cursor !== '0');
    return out;
  }
}

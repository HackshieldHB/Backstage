import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RedisClient } from '../redis/redis.module';
import type { AuthUser } from './current-user.decorator';

export interface RateLimitOptions {
  /** Max requests per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Bucket name so different routes don't share counters. */
  bucket: string;
}

export const RATE_LIMIT_KEY = 'rateLimit';

/** Per-user (or per-IP for anonymous routes) fixed-window rate limit, Redis-backed. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.DISABLE_RATE_LIMIT === '1') return true;
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const principal = request.user?.id ?? request.ip ?? 'unknown';
    const window = Math.floor(Date.now() / (options.windowSeconds * 1000));
    const key = `ratelimit:${options.bucket}:${principal}:${window}`;

    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, options.windowSeconds + 1);

    if (count > options.limit) {
      throw new HttpException(
        `Rate limit exceeded: max ${options.limit} requests per ${options.windowSeconds}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

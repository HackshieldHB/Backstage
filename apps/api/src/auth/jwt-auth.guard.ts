import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { HUMAN_ONLY_KEY } from '../common/human-only.decorator';
import { AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { API_TOKEN_PREFIX, resolveApiToken } from '../security/api-token-auth';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  /** Present only on special-purpose tokens (e.g. the 2FA login step) — never valid as a session. */
  typ?: string;
}

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * Accepts a session JWT, or an API token (`bs_pat_…`): read-scoped tokens may
 * only make read requests, and no token may call a @HumanOnly() route.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) throw new UnauthorizedException('Missing access token');

    if (token.startsWith(API_TOKEN_PREFIX)) {
      const identity = await resolveApiToken(this.prisma, token);
      if (!identity) throw new UnauthorizedException('Invalid, expired or revoked API token');
      if (this.reflector.getAllAndOverride<boolean>(HUMAN_ONLY_KEY, targets)) {
        throw new ForbiddenException('This action requires signing in — API tokens are not accepted');
      }
      if (identity.scope === 'read' && !READ_ONLY_METHODS.has(request.method.toUpperCase())) {
        throw new ForbiddenException('This API token is read-only');
      }
      request.user = { id: identity.userId, email: identity.email, tokenScope: identity.scope };
      return true;
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (payload.typ) throw new UnauthorizedException('Invalid or expired access token');

    // Normalize here so every consumer sees { id }, never the raw { sub } payload.
    request.user = { id: payload.sub, email: payload.email };
    return true;
  }
}

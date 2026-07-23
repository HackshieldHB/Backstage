import { ConsoleLogger, Injectable, type NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  /** Populated by the auth guard once the caller is known. */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The current request's context, or undefined outside a request (queues, boot). */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Assigns every request a correlation id and makes it ambient for the whole
 * async call chain, so a log line, an error report and the response a user is
 * looking at can be tied together. An inbound X-Request-Id is honoured so the
 * id survives a proxy or a caller that already has one.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const inbound = req.headers['x-request-id'];
    const requestId =
      (typeof inbound === 'string' && inbound.slice(0, 64)) || randomUUID();
    res.setHeader('x-request-id', requestId);
    storage.run({ requestId }, () => next());
  }
}

/** Attaches the authenticated user to the ambient context, once known. */
export function tagContextUser(userId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.userId = userId;
}

/**
 * Logger that emits one JSON object per line in production (so a log shipper
 * can parse it) and stays human-readable in development. Every line carries the
 * request id when there is one.
 */
export class ContextLogger extends ConsoleLogger {
  private static readonly json = process.env.NODE_ENV === 'production';

  private emit(level: string, message: unknown, context?: string, trace?: string) {
    const ctx = currentContext();
    if (!ContextLogger.json) {
      const suffix = ctx ? ` [req ${ctx.requestId.slice(0, 8)}]` : '';
      const text = `${String(message)}${suffix}`;
      if (level === 'error') super.error(text, trace, context);
      else if (level === 'warn') super.warn(text, context);
      else super.log(text, context);
      return;
    }
    process.stdout.write(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        message: typeof message === 'string' ? message : JSON.stringify(message),
        context,
        requestId: ctx?.requestId,
        userId: ctx?.userId,
        ...(trace ? { trace } : {}),
      }) + '\n',
    );
  }

  log(message: unknown, context?: string) {
    this.emit('info', message, context);
  }
  warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }
  error(message: unknown, trace?: string, context?: string) {
    this.emit('error', message, context, trace);
  }
}

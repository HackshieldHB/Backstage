import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ErrorReporter } from './error-reporter';

/** Truncate untrusted client-supplied strings so a report can't blow up a log line. */
function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Sink for browser-side crashes caught by the web app's error boundaries. Public
 * (a crash can happen before or after auth) but rate-limited per IP so it can't
 * be used to flood the error pipeline. Everything lands in the same
 * {@link ErrorReporter} the backend uses, tagged `source: client`.
 */
@Controller('client-errors')
export class ClientErrorsController {
  constructor(private readonly reporter: ErrorReporter) {}

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'client-errors' })
  @Post()
  @HttpCode(202)
  report(
    @Body()
    body: {
      message?: string;
      stack?: string;
      componentStack?: string;
      url?: string;
      userAgent?: string;
    },
  ): { ok: true } {
    const message = clip(body?.message, 500) ?? 'Unknown client error';
    const error = new Error(`[client] ${message}`);
    error.stack = clip(body?.stack, 8000) ?? error.stack;
    this.reporter.report(error, {
      source: 'client',
      url: clip(body?.url, 500),
      componentStack: clip(body?.componentStack, 8000),
      userAgent: clip(body?.userAgent, 500),
    });
    return { ok: true };
  }
}

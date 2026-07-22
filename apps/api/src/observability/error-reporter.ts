import { Injectable, Logger } from '@nestjs/common';
import { currentContext } from './request-context';

export interface ErrorReportContext {
  /** Route or job that failed, e.g. "POST /channels/:id/messages". */
  source?: string;
  [key: string]: unknown;
}

/** Error reporting port. */
@Injectable()
export abstract class ErrorReporter {
  abstract report(error: unknown, context?: ErrorReportContext): void;
}

/**
 * Default when no DSN is configured: the error still reaches the log with its
 * request id, it just is not aggregated anywhere.
 */
@Injectable()
export class LoggingErrorReporter extends ErrorReporter {
  private readonly logger = new Logger('ErrorReporter');

  report(error: unknown, context: ErrorReportContext = {}): void {
    const ctx = currentContext();
    const where = context.source ? ` at ${context.source}` : '';
    const req = ctx ? ` [req ${ctx.requestId}]` : '';
    this.logger.error(
      `Unhandled error${where}${req}: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

/** Sends to Sentry, tagged with the request id so a report links to its logs. */
@Injectable()
export class SentryErrorReporter extends ErrorReporter {
  constructor(private readonly sentry: typeof import('@sentry/node')) {
    super();
  }

  report(error: unknown, context: ErrorReportContext = {}): void {
    const ctx = currentContext();
    this.sentry.withScope((scope) => {
      if (ctx) {
        scope.setTag('request_id', ctx.requestId);
        if (ctx.userId) scope.setUser({ id: ctx.userId });
      }
      if (context.source) scope.setTag('source', context.source);
      scope.setContext('details', context as Record<string, unknown>);
      this.sentry.captureException(error);
    });
  }
}

/**
 * Selected by SENTRY_DSN. Mirrors the email and storage adapters: real
 * implementation when configured, a visible warning in production when not.
 */
export function createErrorReporter(): ErrorReporter {
  const logger = new Logger('ErrorReporter');
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('SENTRY_DSN is not set — errors are logged but not aggregated anywhere.');
    }
    return new LoggingErrorReporter();
  }
  // Required lazily so installs without a DSN never pay to load the SDK.
  const sentry = require('@sentry/node') as typeof import('@sentry/node');
  sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
  });
  logger.log('Error reporting via Sentry');
  return new SentryErrorReporter(sentry);
}

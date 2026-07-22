import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorReporter } from '../observability/error-reporter';
import { currentContext } from '../observability/request-context';

/** Maps every error to the { data: null, error: { code, message, details? } } envelope. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly reporter: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const asRecord = body as Record<string, unknown>;
        message = typeof asRecord.message === 'string' ? asRecord.message : exception.message;
        if (Array.isArray(asRecord.message)) message = asRecord.message.join('; ');
        if (asRecord.details !== undefined) details = asRecord.details;
      }
    } else {
      this.reporter.report(exception, {
        source: `${request?.method ?? '?'} ${request?.route?.path ?? request?.url ?? '?'}`,
      });
    }

    // The request id goes back to the caller so a bug report can be matched to
    // the server-side log and error report for the exact same request.
    const requestId = currentContext()?.requestId;
    response.status(status).json({
      data: null,
      error: {
        code: status,
        message,
        ...(details !== undefined ? { details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    });
  }
}

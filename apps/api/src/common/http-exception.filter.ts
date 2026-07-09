import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

/** Maps every error to the { data: null, error: { code, message, details? } } envelope. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

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
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({
      data: null,
      error: { code: status, message, ...(details !== undefined ? { details } : {}) },
    });
  }
}

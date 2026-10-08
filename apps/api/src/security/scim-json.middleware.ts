import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const MAX_BYTES = 1_000_000;

/**
 * IdPs send SCIM bodies as `application/scim+json`, which the default JSON
 * parser ignores. Parse them here (size-capped) for the /scim routes only.
 */
@Injectable()
export class ScimJsonMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!type.startsWith('application/scim+json') || (req as { _body?: boolean })._body) return next();

    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const fail = (status: number, detail: string) => {
      if (failed) return;
      failed = true;
      res.status(status).type('application/scim+json').json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: String(status),
        detail,
      });
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        fail(413, 'Request body too large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        req.body = text ? JSON.parse(text) : {};
      } catch {
        return fail(400, 'Malformed JSON body');
      }
      next();
    });
    req.on('error', () => fail(400, 'Could not read request body'));
  }
}

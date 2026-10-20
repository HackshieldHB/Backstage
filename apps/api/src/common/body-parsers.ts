import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * JSON bodies, including LiveKit webhooks (sent as `application/webhook+json`).
 * Registering the json parser here replaces Nest's default one, so it must keep
 * plain `application/json` too. Needs `rawBody: true` on the app for signatures.
 */
export function configureBodyParsers(app: NestExpressApplication) {
  app.useBodyParser('json', { type: ['application/json', 'application/webhook+json'] });
}

import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import compression from 'compression';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureBodyParsers } from './common/body-parsers';
import { ContextLogger } from './observability/request-context';
import { ErrorReporter } from './observability/error-reporter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Keep the raw request bytes next to the parsed body: webhook signatures
    // (GitHub X-Hub-Signature-256) are computed over the exact payload.
    rawBody: true,
    // JSON lines in production, human-readable locally — either way every line
    // carries the request id.
    logger: new ContextLogger(),
  });

  app.use(
    helmet({
      // This is a JSON/media API, not an HTML origin — a document CSP would only
      // get in the way, and the web app sets its own. Keep the other hardening
      // headers (HSTS, X-Content-Type-Options, frameguard, …).
      contentSecurityPolicy: false,
      // Avatars and attachments are fetched cross-origin by the web app, so the
      // default same-origin resource policy would break them.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  configureBodyParsers(app);
  app.use(compression());

  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.enableShutdownHooks();

  // Anything that escapes the request pipeline still reaches the reporter
  // instead of vanishing.
  const reporter = app.get(ErrorReporter);
  process.on('unhandledRejection', (reason) => {
    reporter.report(reason, { source: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    reporter.report(err, { source: 'uncaughtException' });
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new ContextLogger().log(`API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();

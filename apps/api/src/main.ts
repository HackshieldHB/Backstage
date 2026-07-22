import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ContextLogger } from './observability/request-context';
import { ErrorReporter } from './observability/error-reporter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // JSON lines in production, human-readable locally — either way every line
    // carries the request id.
    logger: new ContextLogger(),
  });
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

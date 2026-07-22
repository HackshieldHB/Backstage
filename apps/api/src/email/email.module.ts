import { Global, Logger, Module } from '@nestjs/common';
import { ConsoleEmailService, EmailService } from './email.service';
import { SmtpEmailService } from './smtp-email.service';

/**
 * Picks the email adapter from the environment: SMTP when configured, console
 * otherwise. Resolved in a factory (not at import time) so the choice follows
 * the environment the app actually boots with, and stays testable.
 *
 * The choice is logged at boot — an install silently logging password-reset
 * tokens to stdout instead of mailing them should be visible, not something
 * you discover when a user cannot get back in.
 */
export function createEmailService(): EmailService {
  const logger = new Logger('EmailModule');
  if (process.env.SMTP_HOST) {
    logger.log(`Email delivery via SMTP host ${process.env.SMTP_HOST}`);
    return new SmtpEmailService();
  }
  if (process.env.NODE_ENV === 'production') {
    logger.warn(
      'SMTP_HOST is not set — password reset and invite emails will only be written to the log. ' +
        'Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM to deliver them.',
    );
  } else {
    logger.log('Email delivery via console (set SMTP_HOST to send real mail)');
  }
  return new ConsoleEmailService();
}

@Global()
@Module({
  providers: [{ provide: EmailService, useFactory: createEmailService }],
  exports: [EmailService],
})
export class EmailModule {}

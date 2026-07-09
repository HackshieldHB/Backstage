import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

/** Email port — swap the console adapter for a real provider without touching callers. */
@Injectable()
export abstract class EmailService {
  abstract send(email: OutgoingEmail): Promise<void>;
}

@Injectable()
export class ConsoleEmailService extends EmailService {
  private readonly logger = new Logger('Email');

  async send(email: OutgoingEmail): Promise<void> {
    this.logger.log(`To: ${email.to} | Subject: ${email.subject}\n${email.body}`);
  }
}

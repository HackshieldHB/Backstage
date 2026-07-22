import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { EmailService, type OutgoingEmail } from './email.service';

/**
 * SMTP adapter. Selected by {@link EmailModule} when SMTP_HOST is set; without
 * it the console adapter stays in place for local development.
 *
 * Delivery failures are logged and rethrown rather than swallowed: the two
 * callers (password reset, workspace invite) are flows where silently doing
 * nothing leaves a user permanently locked out, which is exactly how this went
 * unnoticed while the console adapter was the only implementation.
 */
@Injectable()
export class SmtpEmailService extends EmailService implements OnModuleDestroy {
  private readonly logger = new Logger('Email');
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    super();
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transporter = createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 is implicit TLS; 587/25 upgrade via STARTTLS.
      secure: port === 465,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' } }
        : {}),
    });
    this.from = process.env.SMTP_FROM ?? 'Backstages <no-reply@backstages.local>';
  }

  async send(email: OutgoingEmail): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: email.to,
        subject: email.subject,
        text: email.body,
      });
      this.logger.log(`Sent "${email.subject}" to ${email.to} (${info.messageId})`);
    } catch (err) {
      this.logger.error(`Failed to send "${email.subject}" to ${email.to}: ${String(err)}`);
      throw err;
    }
  }

  onModuleDestroy() {
    this.transporter.close();
  }
}

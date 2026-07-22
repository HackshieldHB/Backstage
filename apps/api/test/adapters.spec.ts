import { createEmailService } from '../src/email/email.module';
import { ConsoleEmailService } from '../src/email/email.service';
import { SmtpEmailService } from '../src/email/smtp-email.service';
import { createErrorReporter, LoggingErrorReporter } from '../src/observability/error-reporter';
import { createStorageService } from '../src/attachments/attachments.module';
import { DiskStorageService } from '../src/storage/storage.service';
import { S3StorageService } from '../src/storage/s3-storage.service';

/**
 * These adapters were the gap that made password reset and invites silently
 * dead in production: the console/disk defaults look healthy and log success.
 * The selection is therefore worth pinning down.
 */
describe('environment-selected adapters', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  describe('email', () => {
    it('uses the console adapter when SMTP is not configured', () => {
      delete process.env.SMTP_HOST;
      expect(createEmailService()).toBeInstanceOf(ConsoleEmailService);
    });

    it('uses SMTP as soon as a host is configured', () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '587';
      expect(createEmailService()).toBeInstanceOf(SmtpEmailService);
    });

    it('warns in production when SMTP is missing rather than failing quietly', () => {
      delete process.env.SMTP_HOST;
      process.env.NODE_ENV = 'production';
      const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();
      createEmailService();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SMTP_HOST is not set'));
      warn.mockRestore();
    });
  });

  describe('storage', () => {
    it('uses local disk by default', () => {
      delete process.env.STORAGE_DRIVER;
      expect(createStorageService()).toBeInstanceOf(DiskStorageService);
    });

    it('uses S3 when the driver is selected', () => {
      process.env.STORAGE_DRIVER = 's3';
      process.env.S3_BUCKET = 'test-bucket';
      expect(createStorageService()).toBeInstanceOf(S3StorageService);
    });

    it('refuses to start the S3 driver without a bucket', () => {
      process.env.STORAGE_DRIVER = 's3';
      delete process.env.S3_BUCKET;
      // Failing at boot beats accepting uploads that go nowhere.
      expect(() => createStorageService()).toThrow(/S3_BUCKET/);
    });

    it('warns in production when still on local disk', () => {
      delete process.env.STORAGE_DRIVER;
      process.env.NODE_ENV = 'production';
      const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();
      createStorageService();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('lost on redeploy'));
      warn.mockRestore();
    });
  });

  describe('error reporting', () => {
    it('falls back to logging when no DSN is configured', () => {
      delete process.env.SENTRY_DSN;
      expect(createErrorReporter()).toBeInstanceOf(LoggingErrorReporter);
    });

    it('warns in production when errors are not aggregated anywhere', () => {
      delete process.env.SENTRY_DSN;
      process.env.NODE_ENV = 'production';
      const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();
      createErrorReporter();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SENTRY_DSN is not set'));
      warn.mockRestore();
    });
  });
});

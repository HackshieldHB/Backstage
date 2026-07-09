import { Global, Module } from '@nestjs/common';
import { ConsoleEmailService, EmailService } from './email.service';

@Global()
@Module({
  providers: [{ provide: EmailService, useClass: ConsoleEmailService }],
  exports: [EmailService],
})
export class EmailModule {}

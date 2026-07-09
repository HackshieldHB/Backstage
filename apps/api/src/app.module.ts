import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { GlobalExceptionFilter } from './common/http-exception.filter';

@Module({
  imports: [PrismaModule, EmailModule, AuthModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';

// AuditService comes from the global AuditModule.
@Module({
  controllers: [AdminController],
})
export class AdminModule {}

import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { JoinService } from './join.service';

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, JoinService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}

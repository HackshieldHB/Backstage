import { Controller, Get, Param } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PolicyService } from '../authz/policy.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class AdminController {
  constructor(
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
  ) {}

  @Get('workspaces/:id/audit')
  async auditLog(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    await this.policy.requireWorkspaceMember(user.id, workspaceId, 'ADMIN');
    return this.audit.list(workspaceId);
  }
}

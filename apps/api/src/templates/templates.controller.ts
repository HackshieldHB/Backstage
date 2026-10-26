import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  MessageTemplateSchema,
  UpdateMessageTemplateSchema,
  type MessageTemplateInput,
  type UpdateMessageTemplateInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TemplatesService } from './templates.service';

@Controller()
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('workspaces/:id/templates')
  list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.templates.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/templates')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(MessageTemplateSchema)) body: MessageTemplateInput,
  ) {
    return this.templates.create(user.id, workspaceId, body);
  }

  @Patch('templates/:templateId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
    @Body(new ZodValidationPipe(UpdateMessageTemplateSchema)) body: UpdateMessageTemplateInput,
  ) {
    return this.templates.update(user.id, templateId, body);
  }

  @Delete('templates/:templateId')
  remove(@CurrentUser() user: AuthUser, @Param('templateId') templateId: string) {
    return this.templates.remove(user.id, templateId);
  }
}

import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import {
  CreateTaskJiraIssueSchema,
  LinkTaskJiraIssueSchema,
  type CreateTaskJiraIssueInput,
  type LinkTaskJiraIssueInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TaskJiraService } from './task-jira.service';

@Controller()
export class TaskJiraController {
  constructor(private readonly taskJira: TaskJiraService) {}

  /** Create a new Jira issue from the task and link it. */
  @Post('tasks/:id/jira')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateTaskJiraIssueSchema)) body: CreateTaskJiraIssueInput,
  ) {
    return this.taskJira.createIssue(user.id, id, body.projectKey);
  }

  /** Link the task to an existing issue. */
  @Post('tasks/:id/jira/link')
  link(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(LinkTaskJiraIssueSchema)) body: LinkTaskJiraIssueInput,
  ) {
    return this.taskJira.linkIssue(user.id, id, body.issueKey);
  }

  @Delete('tasks/:id/jira')
  unlink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.taskJira.unlink(user.id, id);
  }
}

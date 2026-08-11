import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import type { MessageDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';

/** Only trigger supported today; the shape stays open for more. */
const TRIGGERS = ['message_posted'] as const;
type Trigger = (typeof TRIGGERS)[number];

interface MessagePostedConfig {
  /** Channel whose messages are watched. */
  channelId: string;
  /** Optional case-insensitive substring the message must contain. */
  keyword?: string;
  /** Channel the action message is posted to. */
  actionChannelId: string;
  /** Body of the posted message. */
  actionText: string;
}

export interface WorkflowInput {
  name: string;
  trigger: Trigger;
  enabled?: boolean;
  config: MessagePostedConfig;
}

export interface WorkflowView {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  config: MessagePostedConfig;
  createdAt: string;
}

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    @Inject(forwardRef(() => IntegrationMessagesService))
    private readonly integrationMessages: IntegrationMessagesService,
  ) {}

  private toView(w: {
    id: string;
    name: string;
    enabled: boolean;
    trigger: string;
    config: unknown;
    createdAt: Date;
  }): WorkflowView {
    return {
      id: w.id,
      name: w.name,
      enabled: w.enabled,
      trigger: w.trigger,
      config: w.config as MessagePostedConfig,
      createdAt: w.createdAt.toISOString(),
    };
  }

  async list(userId: string, workspaceId: string): Promise<WorkflowView[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.workflow.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  private async validate(userId: string, workspaceId: string, input: WorkflowInput) {
    if (!TRIGGERS.includes(input.trigger)) throw new BadRequestException('Unknown trigger');
    if (!input.name?.trim()) throw new BadRequestException('Name is required');
    const { channelId, actionChannelId, actionText } = input.config ?? ({} as MessagePostedConfig);
    if (!channelId || !actionChannelId || !actionText?.trim()) {
      throw new BadRequestException('Trigger channel, action channel and message text are required');
    }
    // The caller must be able to read the watched channel and post to the target.
    await this.policy.requireChannelMember(userId, channelId);
    const target = await this.policy.requireChannelMember(userId, actionChannelId);
    if (target.channel.workspaceId !== workspaceId) {
      throw new ForbiddenException('Channels must belong to this workspace');
    }
  }

  async create(userId: string, workspaceId: string, input: WorkflowInput): Promise<WorkflowView> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    await this.validate(userId, workspaceId, input);
    const created = await this.prisma.workflow.create({
      data: {
        workspaceId,
        name: input.name.trim(),
        trigger: input.trigger,
        enabled: input.enabled ?? true,
        config: input.config as object,
        createdById: userId,
      },
    });
    return this.toView(created);
  }

  async update(userId: string, id: string, input: WorkflowInput): Promise<WorkflowView> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Workflow not found');
    await this.policy.requireWorkspaceMember(userId, existing.workspaceId, 'ADMIN');
    await this.validate(userId, existing.workspaceId, input);
    const updated = await this.prisma.workflow.update({
      where: { id },
      data: {
        name: input.name.trim(),
        trigger: input.trigger,
        enabled: input.enabled ?? existing.enabled,
        config: input.config as object,
      },
    });
    return this.toView(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Workflow not found');
    await this.policy.requireWorkspaceMember(userId, existing.workspaceId, 'ADMIN');
    await this.prisma.workflow.delete({ where: { id } });
  }

  /**
   * Engine entrypoint, called after every user message is persisted. Runs any
   * enabled rule that matches, posting the action message as an app message.
   * Best-effort: a bad rule is logged, never surfaced to the sender.
   */
  async onMessagePosted(message: MessageDto): Promise<void> {
    // Only genuine top-level user messages trigger rules — INTEGRATION posts
    // (including our own actions) never re-trigger, which prevents loops.
    if (message.kind !== 'USER' || message.parentId || !message.channelId) return;
    try {
      const workflows = await this.prisma.workflow.findMany({
        where: { workspaceId: message.workspaceId, enabled: true, trigger: 'message_posted' },
      });
      for (const wf of workflows) {
        const cfg = wf.config as unknown as MessagePostedConfig;
        if (cfg.channelId !== message.channelId) continue;
        if (cfg.keyword && !message.contentText.toLowerCase().includes(cfg.keyword.toLowerCase())) {
          continue;
        }
        await this.integrationMessages.post(channelContainer(cfg.actionChannelId), {
          workspaceId: message.workspaceId,
          contentText: cfg.actionText,
          contentJson: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: cfg.actionText }] }],
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Workflow evaluation failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

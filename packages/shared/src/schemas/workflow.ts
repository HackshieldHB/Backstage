import { z } from 'zod';

/**
 * Workflow automation: one trigger, then up to MAX_WORKFLOW_ACTIONS actions run
 * in order. Action text may use {{variables}} (see WORKFLOW_VARIABLES).
 */

export const WORKFLOW_TRIGGERS = [
  'message_posted',
  'reaction_added',
  'member_joined',
  'incident_declared',
  'schedule',
] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const MAX_WORKFLOW_ACTIONS = 5;

/** Special assignee / recipient meaning "whoever caused the trigger". */
export const TRIGGER_USER = 'trigger_user';

/** Variables available in action text, per trigger. */
export const WORKFLOW_VARIABLES: Record<WorkflowTrigger, string[]> = {
  message_posted: ['user', 'channel', 'message', 'date'],
  reaction_added: ['user', 'channel', 'message', 'emoji', 'date'],
  member_joined: ['user', 'channel', 'date'],
  incident_declared: ['user', 'incident', 'severity', 'date'],
  schedule: ['date'],
};

const text = z.string().trim().min(1).max(4000);
const id = z.string().min(1).max(64);

export const PostMessageActionSchema = z.object({
  type: z.literal('post_message'),
  channelId: id,
  text,
});
export const SendDmActionSchema = z.object({
  type: z.literal('send_dm'),
  /** A user id, or TRIGGER_USER. */
  to: id,
  text,
});
export const CreateTaskActionSchema = z.object({
  type: z.literal('create_task'),
  title: z.string().trim().min(1).max(300),
  /** A user id, or TRIGGER_USER. */
  assignee: id,
  dueInDays: z.number().int().min(0).max(365).optional(),
});

/**
 * POST the run's variables as signed JSON to an external URL. The server also
 * refuses non-public destinations (SSRF guard) — https only.
 */
export const CallWebhookActionSchema = z.object({
  type: z.literal('call_webhook'),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'Enter a full https:// URL'),
});

/**
 * Pause the run until a person approves or rejects. Rejecting stops the run.
 * Later steps can use {{approver}} and {{decision}}.
 */
export const RequestApprovalActionSchema = z.object({
  type: z.literal('request_approval'),
  /** A user id, or TRIGGER_USER. */
  approver: id,
  prompt: text,
});

/** Variable names a form field may not take (they're set by triggers/approvals). */
export const RESERVED_WORKFLOW_VARIABLES = [
  'user',
  'channel',
  'message',
  'emoji',
  'incident',
  'severity',
  'date',
  'approver',
  'decision',
  'respondent',
] as const;

export const WorkflowFormFieldSchema = z.object({
  /** Becomes the {{key}} variable for later steps. */
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,29}$/, 'Use lowercase letters, digits and _ (start with a letter)')
    .refine(
      (k) => !(RESERVED_WORKFLOW_VARIABLES as readonly string[]).includes(k),
      'That name is reserved',
    ),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['text', 'select']),
  /** Choices for a select field. */
  options: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  required: z.boolean().default(true),
});
export type WorkflowFormField = z.infer<typeof WorkflowFormFieldSchema>;

/** Pause the run until a person fills in a short form; answers become {{variables}}. */
export const AskFormActionSchema = z.object({
  type: z.literal('ask_form'),
  /** A user id, or TRIGGER_USER. */
  assignee: id,
  prompt: text,
  fields: z
    .array(WorkflowFormFieldSchema)
    .min(1)
    .max(5)
    .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, 'Field names must be unique')
    .refine(
      (fs) => fs.every((f) => f.kind !== 'select' || (f.options?.length ?? 0) >= 2),
      'A choice field needs at least two options',
    ),
});

export const WorkflowActionSchema = z.discriminatedUnion('type', [
  PostMessageActionSchema,
  SendDmActionSchema,
  CreateTaskActionSchema,
  CallWebhookActionSchema,
  RequestApprovalActionSchema,
  AskFormActionSchema,
]);
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;

/** Steps that pause the run until a person responds. */
export const HUMAN_STEP_TYPES = ['request_approval', 'ask_form'] as const;

const actions = z
  .array(WorkflowActionSchema)
  .min(1)
  .max(MAX_WORKFLOW_ACTIONS)
  .refine((as) => {
    const keys = as.flatMap((a) => (a.type === 'ask_form' ? a.fields.map((f) => f.key) : []));
    return new Set(keys).size === keys.length;
  }, 'Form field names must be unique across the workflow');

/** IANA time zone the runtime actually knows (e.g. "Europe/Berlin"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const SEVERITIES_ORDERED = ['SEV1', 'SEV2', 'SEV3'] as const;

const base = {
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
};

/**
 * Accepts the original single-action shape ({ actionChannelId, actionText })
 * for message_posted and lifts it into `actions`.
 */
function liftLegacy(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const c = raw as Record<string, unknown>;
  if (c.actions === undefined && typeof c.actionChannelId === 'string') {
    const { actionChannelId, actionText, ...rest } = c;
    return {
      ...rest,
      actions: [{ type: 'post_message', channelId: actionChannelId, text: actionText }],
    };
  }
  return raw;
}

export const MessagePostedConfigSchema = z.preprocess(
  liftLegacy,
  z.object({ channelId: id, keyword: z.string().trim().max(100).optional(), actions }),
);
export const ReactionAddedConfigSchema = z.object({
  channelId: id,
  /** Emoji shortcode, e.g. "ticket" or "white_check_mark". */
  emoji: z.string().trim().min(1).max(64),
  actions,
});
export const MemberJoinedConfigSchema = z.object({ channelId: id, actions });
export const IncidentDeclaredConfigSchema = z.object({
  /** Fire for incidents at least this severe (SEV1 is the most severe). */
  minSeverity: z.enum(SEVERITIES_ORDERED).default('SEV3'),
  actions,
});
export const ScheduleConfigSchema = z.object({
  /** Days of week, 0 = Sunday … 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  /** 24h local time "HH:MM". */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)'),
  timeZone: z.string().min(1).max(64).refine(isValidTimeZone, 'Unknown time zone'),
  actions,
});

export const WorkflowInputSchema = z.discriminatedUnion('trigger', [
  z.object({ ...base, trigger: z.literal('message_posted'), config: MessagePostedConfigSchema }),
  z.object({ ...base, trigger: z.literal('reaction_added'), config: ReactionAddedConfigSchema }),
  z.object({ ...base, trigger: z.literal('member_joined'), config: MemberJoinedConfigSchema }),
  z.object({
    ...base,
    trigger: z.literal('incident_declared'),
    config: IncidentDeclaredConfigSchema,
  }),
  z.object({ ...base, trigger: z.literal('schedule'), config: ScheduleConfigSchema }),
]);
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;
export type WorkflowConfig = WorkflowInput['config'];

export interface WorkflowDto {
  id: string;
  name: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  config: WorkflowConfig;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  /** HMAC key for verifying webhook calls — only sent to workspace admins. */
  signingSecret?: string | null;
}

export const WORKFLOW_RUN_STATUSES = [
  'RUNNING',
  'WAITING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'REJECTED',
  'EXPIRED',
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export interface WorkflowRunStepDto {
  index: number;
  type: WorkflowAction['type'];
  ok: boolean;
  detail: string;
  at: string;
}

export interface WorkflowRunDto {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  triggerUser: { id: string; displayName: string } | null;
  steps: WorkflowRunStepDto[];
  startedAt: string;
  finishedAt: string | null;
}

/** A paused run waiting on the viewer (approval or form). */
export interface WorkflowRequestDto {
  runId: string;
  workflowName: string;
  kind: 'request_approval' | 'ask_form';
  prompt: string;
  fields: WorkflowFormField[];
  requestedBy: { id: string; displayName: string } | null;
  createdAt: string;
  expiresAt: string | null;
}

export const RespondToWorkflowRequestSchema = z.union([
  z.object({ decision: z.enum(['approve', 'reject']) }),
  z.object({ answers: z.record(z.string(), z.string().max(2000)) }),
]);
export type RespondToWorkflowRequestInput = z.infer<typeof RespondToWorkflowRequestSchema>;

/** Socket payload: the viewer's pending workflow requests changed. */
export interface WorkflowRequestsChangedPayload {
  workspaceId: string;
}

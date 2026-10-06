import { z } from 'zod';

export const TASK_STATUSES = ['OPEN', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(4000).default(''),
  /** ISO timestamp. */
  dueAt: z.string().datetime().optional(),
  /** Defaults to the creator ("my task"). */
  assigneeId: z.string().min(1).optional(),
  /** Set when a chat message is turned into a task. */
  messageId: z.string().min(1).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

/** Partial update; `null` clears the due date / assignee. */
export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    notes: z.string().max(4000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export interface TaskUserDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface TaskDto {
  id: string;
  workspaceId: string;
  title: string;
  notes: string;
  status: TaskStatus;
  dueAt: string | null;
  assignee: TaskUserDto | null;
  createdBy: TaskUserDto;
  /** Where the task came from (any may be null). */
  messageId: string | null;
  channelId: string | null;
  conversationId: string | null;
  meetingRecordId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Socket payload: a task the recipient can see was created/changed/removed. */
export interface TaskChangedPayload {
  workspaceId: string;
  taskId: string;
  deleted: boolean;
}

import { z } from 'zod';
import { UserDtoSchema } from './auth';

export const WorkspaceRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

export const CreateInviteSchema = z.object({
  /** Omit for a shareable link invite. */
  email: z.string().email().max(255).optional(),
  role: WorkspaceRoleSchema.exclude(['OWNER']).default('MEMBER'),
});
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;

export const UpdateMemberRoleSchema = z.object({
  role: WorkspaceRoleSchema.exclude(['OWNER']),
});
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;

export const WorkspaceDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  ownerId: z.string(),
});
export type WorkspaceDto = z.infer<typeof WorkspaceDtoSchema>;

export const WorkspaceMemberDtoSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  role: WorkspaceRoleSchema,
  deactivatedAt: z.string().nullable(),
  user: UserDtoSchema,
});
export type WorkspaceMemberDto = z.infer<typeof WorkspaceMemberDtoSchema>;

import { z } from 'zod';

/** Personal sidebar sections (named groups of channels/DMs) and channel bookmarks. */

export const MAX_SIDEBAR_SECTIONS = 20;
export const MAX_CHANNEL_BOOKMARKS = 20;

export const CreateSidebarSectionSchema = z.object({
  name: z.string().trim().min(1).max(40),
});
export type CreateSidebarSectionInput = z.infer<typeof CreateSidebarSectionSchema>;

export const UpdateSidebarSectionSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => v.name !== undefined || v.position !== undefined, { message: 'Nothing to update' });
export type UpdateSidebarSectionInput = z.infer<typeof UpdateSidebarSectionSchema>;

/** Move a channel/DM into one of your sections (null = back to the default list). */
export const SetSidebarSectionSchema = z.object({
  sectionId: z.string().min(1).nullable(),
});
export type SetSidebarSectionInput = z.infer<typeof SetSidebarSectionSchema>;

export interface SidebarSectionDto {
  id: string;
  name: string;
  position: number;
}

/** Links only — never javascript:, data: or other schemes. */
export const CreateChannelBookmarkSchema = z.object({
  title: z.string().trim().min(1).max(80),
  url: z
    .string()
    .trim()
    .max(2000)
    // .url() alone accepts any scheme (e.g. javascript:), so pin http(s) too.
    .url('Enter a full http(s):// link')
    .regex(/^https?:\/\/\S+$/i, 'Enter a full http(s):// link'),
});
export type CreateChannelBookmarkInput = z.infer<typeof CreateChannelBookmarkSchema>;

export interface ChannelBookmarkDto {
  id: string;
  channelId: string;
  title: string;
  url: string;
  createdBy: { id: string; displayName: string };
  createdAt: string;
}

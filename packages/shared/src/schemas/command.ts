import { z } from 'zod';

/**
 * A slash command contributed by an integration app.
 *
 * Commands were previously three hardcoded regexes inside the web composer,
 * which meant every new command required editing that component and no client
 * could discover what existed. They are now declared server-side and listed
 * over the API.
 */
export interface SlashCommandDto {
  /** First word after the slash, e.g. "jira". */
  name: string;
  /** Optional second word, so "/jira create" and "/jira KEY-1" can differ. */
  subcommand?: string;
  /** Shown in help, e.g. "/jira KEY-123". */
  usage: string;
  description: string;
  /**
   * When set, the client opens this dialog with the remaining text instead of
   * executing server-side — for commands that need to collect more input.
   */
  dialog?: string;
  /** Commands that only make sense inside a channel. */
  channelOnly: boolean;
}

export const RunCommandSchema = z.object({
  /** Raw composer text, including the leading slash. */
  text: z.string().min(1).max(4000),
});
export type RunCommandInput = z.infer<typeof RunCommandSchema>;

/** Either the command ran, or the client is told which dialog to open. */
export interface CommandResultDto {
  handled: boolean;
  /** Set when the command asked the client to open a dialog. */
  dialog?: string;
  /** Remaining text after the command name, passed to the dialog. */
  args?: string;
  /** Human-readable outcome for commands that ran server-side. */
  message?: string;
}

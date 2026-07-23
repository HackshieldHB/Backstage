import { BadRequestException, Injectable } from '@nestjs/common';
import type { CommandResultDto, SlashCommandDto } from '@backstages/shared';

/** Everything a command handler needs to act. */
export interface CommandContext {
  userId: string;
  workspaceId: string;
  /** Null when the command was run outside a channel. */
  channelId: string | null;
}

/**
 * A slash command contributed by an app. A command either runs server-side
 * (`run`) or tells the client to open a dialog (`dialog`) — never both.
 */
export interface SlashCommand {
  name: string;
  subcommand?: string;
  usage: string;
  description: string;
  channelOnly?: boolean;
  dialog?: string;
  run?(ctx: CommandContext, args: string): Promise<CommandResultDto>;
}

/**
 * A pluggable integration ("app") that extends chat. Apps implement the hooks
 * they support and register themselves with the {@link AppRegistry} on init.
 * This is the seam that turns "Jira baked into core" into "Jira is one app" —
 * adding a second app (GitHub, …) means implementing this interface, not
 * threading new `if` branches through the messaging core.
 */
export interface IntegrationApp {
  /** Stable identifier, e.g. 'jira'. */
  readonly id: string;
  /** Compute link unfurls for a message's text, or null when none apply. */
  unfurl?(workspaceId: string, contentText: string): Promise<unknown[] | null>;
  /** Slash commands this app contributes. */
  commands?(): SlashCommand[];
}

/** Splits "/jira create fix the thing" into the command name and the rest. */
export function parseCommand(text: string): { name: string; rest: string } | null {
  const match = /^\/([a-z][a-z0-9-]*)\s*([\s\S]*)$/i.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), rest: match[2].trim() };
}

/** In-process registry of integration apps, consulted by the messaging core. */
@Injectable()
export class AppRegistry {
  private readonly apps = new Map<string, IntegrationApp>();

  register(app: IntegrationApp): void {
    this.apps.set(app.id, app);
  }

  list(): IntegrationApp[] {
    return [...this.apps.values()];
  }

  /** Merges unfurls from every registered app; one app failing never throws. */
  async unfurl(workspaceId: string, contentText: string): Promise<unknown[] | null> {
    const merged: unknown[] = [];
    for (const app of this.apps.values()) {
      if (!app.unfurl) continue;
      try {
        const res = await app.unfurl(workspaceId, contentText);
        if (res) merged.push(...res);
      } catch {
        // An integration's failure must never break message delivery.
      }
    }
    return merged.length > 0 ? merged : null;
  }

  /** Every command every app contributes, for help and client dispatch. */
  commands(): SlashCommand[] {
    const all: SlashCommand[] = [];
    for (const app of this.apps.values()) {
      if (app.commands) all.push(...app.commands());
    }
    return all;
  }

  describeCommands(): SlashCommandDto[] {
    return this.commands().map((c) => ({
      name: c.name,
      ...(c.subcommand ? { subcommand: c.subcommand } : {}),
      usage: c.usage,
      description: c.description,
      ...(c.dialog ? { dialog: c.dialog } : {}),
      channelOnly: c.channelOnly ?? false,
    }));
  }

  /**
   * Resolves text to a command. A subcommand match always wins over the bare
   * name, so "/jira create x" never resolves to "/jira" with args "create x".
   */
  resolve(text: string): { command: SlashCommand; args: string } | null {
    const parsed = parseCommand(text);
    if (!parsed) return null;
    const candidates = this.commands().filter((c) => c.name === parsed.name);
    if (candidates.length === 0) return null;

    const firstWord = parsed.rest.split(/\s+/)[0]?.toLowerCase() ?? '';
    const withSub = candidates.find((c) => c.subcommand && c.subcommand === firstWord);
    if (withSub) {
      return { command: withSub, args: parsed.rest.slice(firstWord.length).trim() };
    }
    const bare = candidates.find((c) => !c.subcommand);
    return bare ? { command: bare, args: parsed.rest } : null;
  }

  /** Executes a command, or reports which dialog the client should open. */
  async run(ctx: CommandContext, text: string): Promise<CommandResultDto> {
    const resolved = this.resolve(text);
    if (!resolved) {
      const parsed = parseCommand(text);
      throw new BadRequestException(parsed ? `Unknown command /${parsed.name}` : 'Not a command');
    }
    const { command, args } = resolved;
    if (command.channelOnly && !ctx.channelId) {
      throw new BadRequestException(`${command.usage} only works in a channel`);
    }
    // Dialog commands need more input than one line carries; the client
    // collects it and calls the app's own endpoint.
    if (command.dialog) return { handled: true, dialog: command.dialog, args };
    if (!command.run) throw new BadRequestException(`${command.usage} is not runnable`);
    return command.run(ctx, args);
  }
}

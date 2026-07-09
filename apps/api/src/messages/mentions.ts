/** Mention targets extracted from a TipTap document. */
export interface ExtractedMentions {
  userIds: string[];
  channel: boolean;
  here: boolean;
}

/**
 * Walks a TipTap JSON doc for mention nodes: { type: 'mention', attrs: { id } }.
 * `id` is a user id, or the specials 'channel' / 'here'.
 */
export function extractMentions(contentJson: unknown): ExtractedMentions {
  const userIds = new Set<string>();
  let channel = false;
  let here = false;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (rec.type === 'mention' && rec.attrs && typeof rec.attrs === 'object') {
      const id = (rec.attrs as Record<string, unknown>).id;
      if (id === 'channel') channel = true;
      else if (id === 'here') here = true;
      else if (typeof id === 'string' && id.length > 0) userIds.add(id);
    }
    if (rec.content) walk(rec.content);
  };

  walk(contentJson);
  return { userIds: [...userIds], channel, here };
}

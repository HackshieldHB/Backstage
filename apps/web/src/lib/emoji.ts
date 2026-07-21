import data from '@emoji-mart/data';

/**
 * Resolves an emoji shortcode/id (as stored on reactions and statuses) to its
 * native character. Backed by the full emoji-mart dataset so *any* emoji picked
 * from the picker renders, not just a hand-curated handful — the picker emits
 * the canonical id, and aliases (e.g. `thumbsup` → `+1`) resolve too.
 */
interface EmojiData {
  emojis: Record<string, { skins?: Array<{ native?: string }> }>;
  aliases?: Record<string, string>;
}

const dataset = data as unknown as EmojiData;

// A few hand overrides for ids used as quick reactions / legacy stored values.
const OVERRIDES: Record<string, string> = {
  thumbsup: '👍',
  '+1': '👍',
  '-1': '👎',
  check: '✅',
};

export function emojiChar(code: string): string {
  if (!code) return '';
  if (OVERRIDES[code]) return OVERRIDES[code];
  const id = dataset.aliases?.[code] ?? code;
  const native = dataset.emojis?.[id]?.skins?.[0]?.native;
  return native ?? `:${code}:`;
}

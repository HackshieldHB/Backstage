/** "https://…/invite/<token>" or the bare token → the token, or null if it isn't one. */
export function inviteTokenFrom(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const m = /\/invite\/([^/?#\s]+)/.exec(value);
  const token = m ? m[1] : value;
  return /^[\w-]{16,200}$/.test(token) ? token : null;
}

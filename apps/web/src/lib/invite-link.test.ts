import { describe, it, expect } from 'vitest';
import { inviteTokenFrom } from './invite-link';

describe('inviteTokenFrom', () => {
  const token = 'Abc_def-1234567890XYZabcdefghij';

  it('reads the token from a full invite link', () => {
    expect(inviteTokenFrom(`https://chat.example.com/invite/${token}`)).toBe(token);
    expect(inviteTokenFrom(`  https://x.trycloudflare.com/invite/${token}?ref=mail#top  `)).toBe(token);
  });

  it('accepts a bare token', () => {
    expect(inviteTokenFrom(token)).toBe(token);
  });

  it('rejects things that are not invite tokens', () => {
    expect(inviteTokenFrom('')).toBeNull();
    expect(inviteTokenFrom('hello')).toBeNull();
    expect(inviteTokenFrom('https://example.com/some/page')).toBeNull();
    expect(inviteTokenFrom('<script>alert(1)</script>')).toBeNull();
  });
});

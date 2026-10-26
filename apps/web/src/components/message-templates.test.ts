import { describe, expect, it } from 'vitest';
import { fillTemplate } from './message-templates';

describe('fillTemplate', () => {
  const now = new Date(2026, 9, 26, 9, 5);

  it('fills {{me}}, {{date}} and {{time}}, tolerating spaces and case', () => {
    const out = fillTemplate('Hi from {{ me }} on {{DATE}} at {{time}}', {
      me: 'Kevin',
      now,
      locale: 'en-US',
    });
    expect(out).toContain('Hi from Kevin on ');
    expect(out).toContain('Oct');
    expect(out).toContain('2026');
    expect(out).toMatch(/09:05|9:05/);
    expect(out).not.toContain('{{');
  });

  it('leaves unknown variables and plain text alone', () => {
    expect(fillTemplate('Yesterday:\nToday: {{ticket}}', { me: 'K', now })).toBe(
      'Yesterday:\nToday: {{ticket}}',
    );
  });
});

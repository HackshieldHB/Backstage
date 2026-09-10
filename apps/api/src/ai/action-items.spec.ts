import { parseActionItems } from './ai.service';

describe('parseActionItems', () => {
  it('returns nothing for the NONE sentinel (any casing/whitespace)', () => {
    expect(parseActionItems('NONE')).toEqual([]);
    expect(parseActionItems('  none  ')).toEqual([]);
  });

  it('strips bullets and numbering, keeping the item text', () => {
    const raw = ['- Ship the login fix', '* Email the client', '1. Update the runbook', '2) Book the retro'].join('\n');
    expect(parseActionItems(raw)).toEqual([
      'Ship the login fix',
      'Email the client',
      'Update the runbook',
      'Book the retro',
    ]);
  });

  it('drops blank lines', () => {
    expect(parseActionItems('First\n\n   \nSecond')).toEqual(['First', 'Second']);
  });

  it('caps the list at 12 items', () => {
    const raw = Array.from({ length: 20 }, (_, i) => `Task ${i}`).join('\n');
    expect(parseActionItems(raw)).toHaveLength(12);
  });
});

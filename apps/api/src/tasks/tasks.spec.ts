import { matchOwner, splitOwnerPrefix } from './tasks.service';

describe('splitOwnerPrefix', () => {
  it('splits "Owner — task" on em/en dashes and spaced hyphens', () => {
    expect(splitOwnerPrefix('Kevin — review the config')).toEqual({
      owner: 'Kevin',
      text: 'review the config',
    });
    expect(splitOwnerPrefix('Ada Lovelace – ship it')).toEqual({
      owner: 'Ada Lovelace',
      text: 'ship it',
    });
    expect(splitOwnerPrefix('Bob - write docs')).toEqual({ owner: 'Bob', text: 'write docs' });
  });

  it('keeps hyphenated names intact and leaves prefix-less items alone', () => {
    expect(splitOwnerPrefix('Mary-Jane — book the room')).toEqual({
      owner: 'Mary-Jane',
      text: 'book the room',
    });
    expect(splitOwnerPrefix('Write the release notes')).toEqual({
      owner: null,
      text: 'Write the release notes',
    });
    expect(splitOwnerPrefix('Fix the follow-up bug')).toEqual({
      owner: null,
      text: 'Fix the follow-up bug',
    });
  });
});

describe('matchOwner', () => {
  const people = [
    { id: 'u1', displayName: 'Ada Lovelace' },
    { id: 'u2', displayName: 'Bob Stone' },
    { id: 'u3', displayName: 'Bob Marley' },
  ];

  it('matches a full display name case-insensitively', () => {
    expect(matchOwner('bob stone', people)).toBe('u2');
  });

  it('matches a unique first name', () => {
    expect(matchOwner('Ada', people)).toBe('u1');
  });

  it('refuses ambiguous or unknown names', () => {
    expect(matchOwner('Bob', people)).toBeNull();
    expect(matchOwner('Grace', people)).toBeNull();
    expect(matchOwner('  ', people)).toBeNull();
  });
});

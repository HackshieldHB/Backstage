import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DICTIONARY, translate, useReasonT, useT } from './i18n';
import { useUiStore } from '@/stores/ui-store';

describe('useT', () => {
  beforeEach(() => useUiStore.getState().setLang('en'));

  it('translates known keys in English', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('threads')).toBe('Threads');
    expect(result.current('team_timeline')).toBe('Team timeline');
  });

  it('translates known keys in Indonesian', () => {
    useUiStore.getState().setLang('id');
    const { result } = renderHook(() => useT());
    expect(result.current('threads')).toBe('Utas');
    expect(result.current('team_timeline')).toBe('Timeline tim');
  });

  it('fills {placeholders} and translates new surfaces', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('from_person', { name: 'Ada' })).toBe('from Ada');
    useUiStore.getState().setLang('id');
    const { result: id } = renderHook(() => useT());
    expect(id.current('from_person', { name: 'Ada' })).toBe('dari Ada');
    expect(id.current('my_day')).toBe('Hariku');
    expect(id.current('requests_for_you')).toBe('Permintaan untukmu');
  });

  it('translates known server reasons and passes unknown ones through', () => {
    useUiStore.getState().setLang('id');
    const { result } = renderHook(() => useReasonT());
    expect(result.current('Overdue')).toBe('Terlambat');
    expect(result.current('Due Fri, Oct 10')).toBe('Due Fri, Oct 10');
  });

  it('has non-empty English and Indonesian text for every key', () => {
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      expect({ key, en: entry.en.trim().length > 0 }).toEqual({ key, en: true });
      expect({ key, id: entry.id.trim().length > 0 }).toEqual({ key, id: true });
    }
    expect(translate('id', 'search.tasks')).toBe('Tugas');
  });

  it('falls back to the key itself for unknown keys', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('does.not.exist')).toBe('does.not.exist');
  });
});

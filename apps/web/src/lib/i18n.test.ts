import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useT } from './i18n';
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

  it('falls back to the key itself for unknown keys', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('does.not.exist')).toBe('does.not.exist');
  });
});

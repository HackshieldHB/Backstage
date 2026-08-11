import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ShortcutsHelp } from './shortcuts-help';

function pressQuestionMark() {
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })));
}

describe('ShortcutsHelp', () => {
  it('opens the cheatsheet when "?" is pressed', () => {
    render(<ShortcutsHelp />);
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull();
    pressQuestionMark();
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy();
  });

  it('ignores "?" while typing in an input', () => {
    render(
      <div>
        <input data-testid="field" />
        <ShortcutsHelp />
      </div>,
    );
    (screen.getByTestId('field') as HTMLInputElement).focus();
    pressQuestionMark();
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull();
  });
});

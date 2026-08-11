import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Dialog } from './dialog';

describe('Dialog', () => {
  it('moves focus into the dialog on open and restores it on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <Dialog title="Test" onClose={() => {}}>
        <button>Inside</button>
      </Dialog>,
    );

    // The close button is the first focusable element in the panel.
    expect((document.activeElement as HTMLElement)?.getAttribute('aria-label')).toBe('Close');

    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it('exposes modal semantics for assistive tech', () => {
    render(
      <Dialog title="Labelled" onClose={() => {}}>
        body
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Labelled');
  });

  it('closes on Escape', () => {
    let closed = false;
    render(
      <Dialog title="T" onClose={() => (closed = true)}>
        x
      </Dialog>,
    );
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(closed).toBe(true);
  });
});

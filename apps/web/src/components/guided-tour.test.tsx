import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GuidedTour, type TourStep } from './guided-tour';

const labels = { skip: 'Skip', back: 'Back', next: 'Next', done: 'Done' };
const steps: TourStep[] = [
  { title: 'Welcome', body: 'hello' },
  { title: 'Second', body: 'more' },
];

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

describe('GuidedTour', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setWidth(1200);
  });
  afterEach(() => vi.useRealTimers());

  it('auto-opens on first run (desktop) after the mount delay', () => {
    render(<GuidedTour storageKey="k1" steps={steps} labels={labels} />);
    expect(screen.queryByTestId('guided-tour')).toBeNull();
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByTestId('guided-tour')).not.toBeNull();
    expect(screen.getByText('Welcome')).toBeTruthy();
  });

  it('does not auto-open below desktop width', () => {
    setWidth(500);
    render(<GuidedTour storageKey="k2" steps={steps} labels={labels} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('guided-tour')).toBeNull();
  });

  it('advances through steps then finishes, persisting completion', () => {
    render(<GuidedTour storageKey="k3" steps={steps} labels={labels} />);
    act(() => vi.advanceTimersByTime(800));
    fireEvent.click(screen.getByTestId('guided-tour-next'));
    expect(screen.getByText('Second')).toBeTruthy();
    fireEvent.click(screen.getByTestId('guided-tour-next'));
    expect(screen.queryByTestId('guided-tour')).toBeNull();
    expect(window.localStorage.getItem('k3')).toBe('1');
  });

  it('does not auto-open when already completed', () => {
    window.localStorage.setItem('k4', '1');
    render(<GuidedTour storageKey="k4" steps={steps} labels={labels} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('guided-tour')).toBeNull();
  });

  it('replays on the configured window event even after completion', () => {
    window.localStorage.setItem('k5', '1');
    render(
      <GuidedTour storageKey="k5" steps={steps} labels={labels} replayEvent="bs:start-tour" />,
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('guided-tour')).toBeNull();
    act(() => window.dispatchEvent(new Event('bs:start-tour')));
    expect(screen.queryByTestId('guided-tour')).not.toBeNull();
    expect(screen.getByText('Welcome')).toBeTruthy();
  });
});

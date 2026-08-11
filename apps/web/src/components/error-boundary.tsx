'use client';

import { Component, type ReactNode } from 'react';
import { reportClientError } from '@/lib/report-error';

/** Bilingual copy without pulling in the store — a crashed store must not break the fallback. */
function copy() {
  const id =
    typeof window !== 'undefined' && window.localStorage.getItem('bs.lang') === 'id';
  return id
    ? { title: 'Ada yang bermasalah', body: 'Bagian ini gagal dimuat. Coba lagi.', retry: 'Coba lagi' }
    : { title: 'Something went wrong', body: 'This section failed to load. Try again.', retry: 'Try again' };
}

interface Props {
  children: ReactNode;
  /** Optional custom fallback; receives a reset callback to retry rendering. */
  fallback?: (reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors in its subtree, reports them to the API, and
 * shows a recoverable fallback instead of letting the whole app white-screen.
 * Wrap independent heavy panes so one failing widget stays contained.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    reportClientError(error, { componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);

    const c = copy();
    return (
      <div className="flex h-full min-h-40 flex-1 items-center justify-center p-6">
        <div className="max-w-sm rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-sm font-bold">{c.title}</h2>
          <p className="mt-1 text-sm text-gray-500">{c.body}</p>
          <button
            onClick={this.reset}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            {c.retry}
          </button>
        </div>
      </div>
    );
  }
}

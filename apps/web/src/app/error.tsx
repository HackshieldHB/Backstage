'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-error';

/** Route-segment error boundary: catches errors thrown while rendering any page. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  const id = typeof window !== 'undefined' && window.localStorage.getItem('bs.lang') === 'id';
  const t = id
    ? { title: 'Ada yang bermasalah', body: 'Maaf, terjadi kesalahan tak terduga.', retry: 'Coba lagi', reload: 'Muat ulang halaman' }
    : { title: 'Something went wrong', body: 'Sorry, an unexpected error occurred.', retry: 'Try again', reload: 'Reload page' };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-lg font-bold">{t.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.body}</p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-gray-400">ref: {error.digest}</p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            {t.retry}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            {t.reload}
          </button>
        </div>
      </div>
    </main>
  );
}

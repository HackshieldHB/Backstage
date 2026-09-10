'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { ACCENTS, useUiStore, type AccentId } from '@/stores/ui-store';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const setAccent = useUiStore((s) => s.setAccent);

  useEffect(() => {
    void bootstrap();
    // A theme carries its own light/dark mode, so applying the saved theme is enough.
    const savedAccent = window.localStorage.getItem('bs.accent') as AccentId | null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme =
      savedAccent && ACCENTS.includes(savedAccent) ? savedAccent : prefersDark ? 'midnight' : 'daylight';
    setAccent(theme);
  }, [bootstrap, setAccent]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

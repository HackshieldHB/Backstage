'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';

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
  const setTheme = useUiStore((s) => s.setTheme);

  useEffect(() => {
    void bootstrap();
    const saved = window.localStorage.getItem('bs.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(saved === 'dark' || (!saved && prefersDark) ? 'dark' : 'light');
  }, [bootstrap, setTheme]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

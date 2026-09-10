import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { PwaRegistrar } from '@/components/pwa-registrar';

export const metadata: Metadata = {
  title: 'Backstages',
  description: 'Team chat for people who ship',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: 'Backstages', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-canvas text-ink antialiased">
        <Providers>{children}</Providers>
        <PwaRegistrar />
      </body>
    </html>
  );
}

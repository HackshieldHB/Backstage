import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 p-6 text-center dark:bg-gray-950">
      <p className="text-4xl font-black text-accent">404</p>
      <h1 className="text-lg font-bold">Page not found</h1>
      <p className="max-w-sm text-sm text-gray-500">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/app"
        className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
      >
        Back to Backstages
      </Link>
    </main>
  );
}

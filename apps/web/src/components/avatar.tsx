'use client';

import clsx from 'clsx';
import type { UserDto } from '@backstages/shared';

const PALETTE = ['bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-cyan-500', 'bg-blue-500', 'bg-violet-500', 'bg-fuchsia-500'];

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % PALETTE.length;
  return PALETTE[h];
}

export function Avatar({
  user,
  size = 'md',
  presence,
  className,
}: {
  user: Pick<UserDto, 'id' | 'displayName' | 'avatarUrl'> | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  presence?: string;
  className?: string;
}) {
  const sizes = { xs: 'h-5 w-5 text-[9px]', sm: 'h-6 w-6 text-[10px]', md: 'h-9 w-9 text-sm', lg: 'h-16 w-16 text-xl' };
  const initials = (user?.displayName ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <span className={clsx('relative inline-block shrink-0', className)}>
      {user?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatarUrl}
          alt={user.displayName}
          className={clsx('rounded-md object-cover', sizes[size])}
        />
      ) : (
        <span
          className={clsx(
            'flex items-center justify-center rounded-md font-semibold text-white',
            sizes[size],
            colorFor(user?.id ?? 'x'),
          )}
        >
          {initials}
        </span>
      )}
      {presence && (
        <span
          data-testid="presence-dot"
          className={clsx(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-gray-900',
            presence === 'ACTIVE' && 'bg-green-500',
            presence === 'AWAY' && 'bg-yellow-400',
            presence === 'DND' && 'bg-red-500',
            (presence === 'OFFLINE' || !presence) && 'bg-gray-300 dark:bg-gray-600',
          )}
        />
      )}
    </span>
  );
}

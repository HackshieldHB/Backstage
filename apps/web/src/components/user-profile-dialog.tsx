'use client';

import clsx from 'clsx';
import { MessageSquare } from 'lucide-react';
import type { UserDto } from '@backstages/shared';
import { useAuthStore } from '@/stores/auth-store';
import { emojiChar } from '@/lib/emoji';
import { Avatar } from './avatar';
import { Dialog } from './dialog';

const PRESENCE: Record<string, { label: string; dot: string }> = {
  ACTIVE: { label: 'Active', dot: 'bg-green-500' },
  AWAY: { label: 'Away', dot: 'bg-yellow-400' },
  DND: { label: 'Do not disturb', dot: 'bg-red-500' },
  OFFLINE: { label: 'Offline', dot: 'bg-gray-300 dark:bg-gray-600' },
};

type ProfileUser = Pick<
  UserDto,
  'id' | 'displayName' | 'avatarUrl' | 'statusEmoji' | 'statusText' | 'isProvisional'
> & { email?: string };

/** Read-only profile card for another member. The "Message" action opens (or
 * creates) a DM via a global event handled in the app shell. */
export function UserProfileDialog({
  user,
  presence,
  onClose,
}: {
  user: ProfileUser;
  presence?: string;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const isSelf = me?.id === user.id;
  const p = PRESENCE[presence ?? 'OFFLINE'] ?? PRESENCE.OFFLINE;

  const message = () => {
    window.dispatchEvent(new CustomEvent('bs:open-dm', { detail: user.id }));
    onClose();
  };

  return (
    <Dialog title="Profile" onClose={onClose}>
      <div className="flex items-center gap-3">
        <Avatar user={user} size="lg" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{user.displayName}</span>
            {user.isProvisional && (
              <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                provisional
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500">
            <span className={clsx('h-2.5 w-2.5 rounded-full', p.dot)} />
            {p.label}
          </div>
        </div>
      </div>

      {(user.statusEmoji || user.statusText) && (
        <p className="mt-3 text-sm">
          {user.statusEmoji ? `${emojiChar(user.statusEmoji)} ` : ''}
          {user.statusText}
        </p>
      )}

      {user.email && !user.isProvisional && (
        <p className="mt-3 text-xs text-gray-500">{user.email}</p>
      )}

      {!isSelf && (
        <button
          onClick={message}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          data-testid="profile-message"
        >
          <MessageSquare size={15} /> Message
        </button>
      )}
    </Dialog>
  );
}

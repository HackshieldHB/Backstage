'use client';

import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import type { MessageDto, MessageEditDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { Dialog } from './dialog';
import { MessageBody } from './message-body';

/** Shows a message's current text and every earlier version, newest first. */
export function EditHistoryDialog({ message, onClose }: { message: MessageDto; onClose: () => void }) {
  const edits = useQuery({
    queryKey: ['message-edits', message.id, message.editedAt],
    queryFn: () => api<MessageEditDto[]>('GET', `/messages/${message.id}/edits`),
  });
  const stamp = (iso: string) => format(new Date(iso), 'MMM d, HH:mm');

  return (
    <Dialog title="Edit history" onClose={onClose}>
      <ol className="max-h-[60vh] space-y-3 overflow-y-auto" data-testid="edit-history">
        <li className="rounded-lg border border-accent/40 bg-accent/5 p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
            Current{message.editedAt ? ` · ${stamp(message.editedAt)}` : ''}
          </div>
          <MessageBody contentJson={message.contentJson} contentText={message.contentText} />
        </li>
        {edits.isLoading && <li className="text-[13px] text-ink-3">Loading…</li>}
        {edits.isError && <li className="text-[13px] text-red-500">Could not load earlier versions.</li>}
        {edits.data?.map((v, i) => (
          <li key={`${v.replacedAt}-${i}`} className="rounded-lg border border-line p-3">
            <div className="mb-1 text-[11px] text-ink-3">
              {i === (edits.data?.length ?? 0) - 1 ? 'Original' : 'Earlier'} · {stamp(v.versionAt)}
            </div>
            <MessageBody contentJson={v.contentJson} contentText={v.contentText} />
          </li>
        ))}
        {edits.isSuccess && edits.data.length === 0 && (
          <li className="text-[13px] text-ink-3">No earlier versions were kept for this message.</li>
        )}
      </ol>
    </Dialog>
  );
}

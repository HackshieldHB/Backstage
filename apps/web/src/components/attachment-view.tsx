'use client';

import { useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import type { AttachmentDto } from '@backstages/shared';
import { fileUrl } from '@/lib/api';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentView({ attachments }: { attachments: AttachmentDto[] }) {
  const [lightbox, setLightbox] = useState<AttachmentDto | null>(null);
  if (attachments.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((a) =>
        a.mimeType.startsWith('image/') ? (
          <button key={a.id} onClick={() => setLightbox(a)} title={a.filename} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl(a.url)}
              alt={a.filename}
              className="max-h-64 max-w-xs rounded-lg border border-gray-200 object-cover dark:border-gray-700"
            />
          </button>
        ) : (
          <a
            key={a.id}
            href={`${fileUrl(a.url)}&download=1`}
            className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            <FileText size={20} className="shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block max-w-[180px] truncate text-sm font-medium">{a.filename}</span>
              <span className="block text-xs text-gray-500">{humanSize(a.sizeBytes)}</span>
            </span>
            <Download size={14} className="ml-1 text-gray-500 dark:text-gray-400" />
          </a>
        ),
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Close">
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl(lightbox.url)}
            alt={lightbox.filename}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={`${fileUrl(lightbox.url)}&download=1`}
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-4 flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
          >
            <Download size={14} /> {lightbox.filename}
          </a>
        </div>
      )}
    </div>
  );
}

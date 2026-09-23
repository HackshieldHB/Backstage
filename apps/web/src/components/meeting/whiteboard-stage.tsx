'use client';

import { useState } from 'react';
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  Pencil,
  Slash,
  Square,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react';
import type { HuddleAnnotationShape, HuddleWhiteboardOp } from '@backstages/shared';
import { AnnotationLayer, type AnnotationToolId } from './annotation-layer';

/** Dark-ink palette that reads on the white board. */
const COLORS = ['#111827', '#ef4444', '#2563eb', '#16a34a', '#d97706', '#9333ea'];

const TOOLS: { id: AnnotationToolId; icon: typeof Pencil; label: string }[] = [
  { id: 'pen', icon: Pencil, label: 'Pen' },
  { id: 'highlighter', icon: Highlighter, label: 'Highlighter' },
  { id: 'arrow', icon: ArrowUpRight, label: 'Arrow' },
  { id: 'line', icon: Slash, label: 'Line' },
  { id: 'rect', icon: Square, label: 'Rectangle' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse' },
  { id: 'text', icon: TypeIcon, label: 'Text' },
  { id: 'eraser', icon: Eraser, label: 'Eraser' },
];

/**
 * A standalone shared whiteboard. It reuses the same normalized (0..1) annotation
 * surface as screen annotation, so shapes line up across viewers, but paints on a
 * blank board instead of over a shared screen. There is no laser here.
 */
export function WhiteboardStage({
  shapes,
  canDraw,
  isModerator,
  myId,
  onOp,
  onClear,
}: {
  shapes: HuddleAnnotationShape[];
  canDraw: boolean;
  isModerator: boolean;
  myId: string;
  onOp: (op: HuddleWhiteboardOp) => void;
  onClear: () => void;
}) {
  const [tool, setTool] = useState<AnnotationToolId>('pen');
  const [color, setColor] = useState(COLORS[0]);

  return (
    <div className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-white">
      <div className="absolute inset-0">
        <AnnotationLayer
          annotations={shapes}
          lasers={{}}
          tool={tool}
          color={color}
          canDraw={canDraw}
          myId={myId}
          onOp={onOp}
          onLaser={() => undefined}
        />
      </div>

      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[12px] font-medium text-white">
        Whiteboard
      </div>

      {/* Toolbar */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-gray-900/85 p-1 backdrop-blur">
        {TOOLS.map((t) => {
          const disabled = !canDraw;
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              disabled={disabled}
              title={disabled ? `${t.label} (no permission)` : t.label}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              className={`rounded-lg p-1.5 ${tool === t.id ? 'bg-white text-black' : 'text-white/80 hover:bg-white/15'} disabled:opacity-30`}
            >
              <t.icon size={15} />
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px bg-white/20" />
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Color ${c}`}
            className={`h-4 w-4 rounded-full border ${color === c ? 'border-white ring-2 ring-white/50' : 'border-white/30'}`}
            style={{ background: c }}
          />
        ))}
        {isModerator && (
          <>
            <span className="mx-1 h-5 w-px bg-white/20" />
            <button
              onClick={onClear}
              title="Clear the whiteboard"
              aria-label="Clear the whiteboard"
              className="rounded-lg p-1.5 text-white/80 hover:bg-white/15"
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

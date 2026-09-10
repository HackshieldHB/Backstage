'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Circle,
  Eraser,
  Maximize2,
  MinusCircle,
  MousePointer2,
  Move,
  Pencil,
  PlusCircle,
  Highlighter,
  Slash,
  Square,
  Trash2,
  Type as TypeIcon,
  ArrowUpRight,
  MonitorX,
} from 'lucide-react';
import type { HuddleAnnotationOp, HuddleAnnotationShape } from '@backstages/shared';
import type { LaserState } from '@/hooks/use-huddle';
import { AnnotationLayer, type AnnotationToolId } from './annotation-layer';

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'];

const TOOLS: { id: AnnotationToolId; icon: typeof Pencil; label: string; draw?: boolean }[] = [
  { id: 'laser', icon: MousePointer2, label: 'Laser pointer' },
  { id: 'pen', icon: Pencil, label: 'Pen', draw: true },
  { id: 'highlighter', icon: Highlighter, label: 'Highlighter', draw: true },
  { id: 'arrow', icon: ArrowUpRight, label: 'Arrow', draw: true },
  { id: 'line', icon: Slash, label: 'Line', draw: true },
  { id: 'rect', icon: Square, label: 'Rectangle', draw: true },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', draw: true },
  { id: 'text', icon: TypeIcon, label: 'Text', draw: true },
  { id: 'eraser', icon: Eraser, label: 'Eraser', draw: true },
];

export function ScreenStage({
  stream,
  label,
  live,
  annotations,
  lasers,
  canAnnotate,
  isModerator,
  myId,
  controlLabel,
  onOp,
  onLaser,
  onClear,
}: {
  stream: MediaStream | null;
  label: string;
  live: boolean;
  annotations: HuddleAnnotationShape[];
  lasers: Record<string, LaserState>;
  canAnnotate: boolean;
  isModerator: boolean;
  myId: string;
  /** e.g. "Kevin" when someone has browser-control; null otherwise. */
  controlLabel: string | null;
  onOp: (op: HuddleAnnotationOp) => void;
  onLaser: (p: { x: number; y: number } | null) => void;
  onClear: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<AnnotationToolId>('laser');
  const [color, setColor] = useState(COLORS[0]);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      el.srcObject = stream;
      el.play().catch(() => undefined);
    } else {
      el.srcObject = null;
    }
  }, [stream]);

  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  if (!stream) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl bg-gray-900 text-gray-400">
        <MonitorX size={28} />
        <p className="text-sm">Screen sharing ended</p>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black">
      <div
        className="relative flex h-full w-full items-center justify-center"
        style={{ transform: `scale(${zoom})`, transition: 'transform 120ms' }}
      >
        <video ref={videoRef} autoPlay playsInline muted className="max-h-full max-w-full object-contain" />
        {/* Annotation + laser overlay sits exactly over the video box. */}
        <div className="absolute inset-0">
          <AnnotationLayer
            annotations={annotations}
            lasers={lasers}
            tool={tool}
            color={color}
            canDraw={canAnnotate}
            myId={myId}
            onOp={onOp}
            onLaser={onLaser}
          />
        </div>
      </div>

      {/* Sharing label */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[12px] font-medium text-white">
        {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />}
        {label}
      </div>

      {/* Remote-control indicator (§26 — browser-scoped, never hidden) */}
      {controlLabel && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-red-600/90 px-2 py-1 text-[12px] font-semibold text-white">
          <span className="h-2 w-2 rounded-full bg-white" /> Control: {controlLabel}
        </div>
      )}

      {/* Annotation toolbar — appears on hover; laser always available */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-black/70 p-1 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {TOOLS.map((t) => {
          const disabled = t.draw && !canAnnotate;
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
            <button onClick={onClear} title="Clear all annotations" aria-label="Clear all annotations" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15">
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>

      {/* Viewer controls — zoom + fullscreen */}
      <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-lg bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} title="Zoom out" aria-label="Zoom out" className="rounded p-1.5 text-white/80 hover:bg-white/15">
          <MinusCircle size={15} />
        </button>
        <button onClick={() => setZoom(1)} title="Fit to screen" aria-label="Fit to screen" className="rounded p-1.5 text-white/80 hover:bg-white/15">
          <Move size={15} />
        </button>
        <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} title="Zoom in" aria-label="Zoom in" className="rounded p-1.5 text-white/80 hover:bg-white/15">
          <PlusCircle size={15} />
        </button>
        <button onClick={fullscreen} title="Fullscreen" aria-label="Toggle fullscreen" className="rounded p-1.5 text-white/80 hover:bg-white/15">
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}

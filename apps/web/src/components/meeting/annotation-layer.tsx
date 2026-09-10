'use client';

import { useCallback, useRef, useState } from 'react';
import type {
  HuddleAnnotationShape,
  HuddleAnnotationTool,
  HuddleAnnotationOp,
} from '@backstages/shared';
import type { LaserState } from '@/hooks/use-huddle';

export type AnnotationToolId = HuddleAnnotationTool | 'laser' | 'eraser';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Convert a shape's normalized points into an SVG path/element. */
function ShapeEl({ shape }: { shape: HuddleAnnotationShape }) {
  const p = shape.points;
  const common = {
    stroke: shape.color,
    fill: 'none',
    strokeWidth: shape.tool === 'highlighter' ? 10 : 3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeOpacity: shape.tool === 'highlighter' ? 0.4 : 1,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  if (shape.tool === 'pen' || shape.tool === 'highlighter') {
    if (p.length < 2) return null;
    return <polyline points={p.map((pt) => `${pt.x},${pt.y}`).join(' ')} {...common} />;
  }
  if (p.length < 2) return null;
  const [a, b] = [p[0], p[p.length - 1]];
  if (shape.tool === 'line') return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />;
  if (shape.tool === 'arrow') {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const h = 0.02;
    const wing = 0.5;
    return (
      <g {...common}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line x1={b.x} y1={b.y} x2={b.x - h * Math.cos(ang - wing)} y2={b.y - h * Math.sin(ang - wing)} />
        <line x1={b.x} y1={b.y} x2={b.x - h * Math.cos(ang + wing)} y2={b.y - h * Math.sin(ang + wing)} />
      </g>
    );
  }
  if (shape.tool === 'rect')
    return (
      <rect
        x={Math.min(a.x, b.x)}
        y={Math.min(a.y, b.y)}
        width={Math.abs(b.x - a.x)}
        height={Math.abs(b.y - a.y)}
        {...common}
      />
    );
  if (shape.tool === 'ellipse')
    return (
      <ellipse cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.abs(b.x - a.x) / 2} ry={Math.abs(b.y - a.y) / 2} {...common} />
    );
  if (shape.tool === 'text' && shape.text)
    return (
      <text x={a.x} y={a.y} fill={shape.color} fontSize={0.035} style={{ userSelect: 'none' }}>
        {shape.text}
      </text>
    );
  return null;
}

/**
 * A collaborative annotation surface drawn in a normalized 0..1 viewBox so shapes
 * line up regardless of each viewer's screen size. Emits create/update/delete ops
 * (never screenshots); pen/shape strokes stream via throttled `update`.
 */
export function AnnotationLayer({
  annotations,
  lasers,
  tool,
  color,
  canDraw,
  myId,
  onOp,
  onLaser,
}: {
  annotations: HuddleAnnotationShape[];
  lasers: Record<string, LaserState>;
  tool: AnnotationToolId;
  color: string;
  canDraw: boolean;
  myId: string;
  onOp: (op: HuddleAnnotationOp) => void;
  onLaser: (point: { x: number; y: number } | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef<HuddleAnnotationShape | null>(null);
  const [draft, setDraft] = useState<HuddleAnnotationShape | null>(null);
  const lastEmit = useRef(0);
  const lastLaser = useRef(0);

  const norm = useCallback((e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }, []);

  const interactive = tool === 'laser' ? true : canDraw && tool !== undefined;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    const pt = norm(e);
    if (tool === 'laser') {
      onLaser(pt);
      return;
    }
    if (!canDraw) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === 'eraser') {
      // Delete the topmost shape near the click.
      const hit = [...annotations].reverse().find((s) => s.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 0.03));
      if (hit) onOp({ kind: 'delete', id: hit.id });
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Annotation text');
      if (text) onOp({ kind: 'create', shape: { id: uid(), userId: myId, tool: 'text', color, points: [pt], text, createdAt: Date.now() } });
      return;
    }
    const shape: HuddleAnnotationShape = {
      id: uid(),
      userId: myId,
      tool: tool as HuddleAnnotationTool,
      color,
      points: [pt, pt],
      createdAt: Date.now(),
    };
    drawing.current = shape;
    setDraft(shape);
    onOp({ kind: 'create', shape });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (tool === 'laser') {
      const now = performance.now();
      if (now - lastLaser.current > 45) {
        lastLaser.current = now;
        onLaser(norm(e));
      }
      return;
    }
    const shape = drawing.current;
    if (!shape) return;
    const pt = norm(e);
    if (shape.tool === 'pen' || shape.tool === 'highlighter') shape.points.push(pt);
    else shape.points[1] = pt;
    setDraft({ ...shape, points: [...shape.points] });
    const now = performance.now();
    if (now - lastEmit.current > 60) {
      lastEmit.current = now;
      onOp({ kind: 'update', shape: { ...shape, points: [...shape.points] } });
    }
  };

  const endStroke = () => {
    const shape = drawing.current;
    if (shape) onOp({ kind: 'update', shape: { ...shape, points: [...shape.points] } });
    drawing.current = null;
    setDraft(null);
  };
  const onPointerUp = () => {
    if (tool === 'laser') {
      onLaser(null);
      return;
    }
    endStroke();
  };

  const all = draft ? [...annotations.filter((s) => s.id !== draft.id), draft] : annotations;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      style={{ cursor: interactive ? (tool === 'laser' ? 'none' : 'crosshair') : 'default', pointerEvents: interactive ? 'auto' : 'none', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {all.map((s) => (
        <ShapeEl key={s.id} shape={s} />
      ))}
      {Object.values(lasers).map((l) => (
        <g key={l.userId}>
          <circle cx={l.point.x} cy={l.point.y} r={0.008} fill="#ef4444" opacity={0.9} />
          <text x={l.point.x + 0.012} y={l.point.y} fontSize={0.022} fill="#ef4444">
            {l.displayName}
          </text>
        </g>
      ))}
    </svg>
  );
}

import type { CadSketch } from '@wbcnc/cad';
import { useState } from 'react';
import { INLINE_CONSTRAINT_SIZE, layoutInlineConstraints, type InlineConstraintKind } from './inlineConstraintLayout';

export interface InlineConstraintsProps {
  sketch: CadSketch;
  /** Uniform screen pixels per model unit. Parent SVG uses (x, -y) coordinates. */
  scale: number;
  selectedConstraintIds: readonly string[] | ReadonlySet<string>;
  conflictedConstraintIds?: readonly string[];
  /** Tool modes keep annotations visible while pointer hits pass through to the sketch. */
  interactive?: boolean;
  hoveredConstraintId?: string | null;
  onSelect: (id: string, additive: boolean) => void;
  onHover?: (id: string | null, entityIds: string[]) => void;
  /** Geometric relations have no numeric value editor. Double-click never removes them. */
  onEdit?: (id: string) => void;
}

export function ConstraintSymbol({ kind }: { kind: InlineConstraintKind }) {
  switch (kind) {
    case 'horizontal':
    case 'horizontalPoints':
      return <path d="M-5 0H5" />;
    case 'vertical':
    case 'verticalPoints':
      return <path d="M0-5V5" />;
    case 'coincident':
      return (
        <>
          <circle r="4.5" />
          <circle r="1.2" fill="currentColor" stroke="none" />
        </>
      );
    case 'pointOnLine':
    case 'pointOnCircle':
    case 'pointOnCurve':
      return (
        <>
          <path d="M-6 4L6-4" />
          <circle r="2.7" fill="var(--cad-constraint-fill, #fff)" />
        </>
      );
    case 'midpoint':
      return <path d="M0-5L5 4H-5Z" />;
    case 'tangent':
      return (
        <>
          <circle cy="-1" r="4" />
          <path d="M-6 3H6" />
        </>
      );
    case 'equal':
      return <path d="M-5-2H5M-5 2H5" />;
    case 'parallel':
      return <path d="M-5 5L-1-5M1 5L5-5" />;
    case 'symmetricPoints':
      return (
        <>
          <path d="M0-6V6" strokeDasharray="2 2" />
          <path d="m-6-3 3 3-3 3m12-6-3 3 3 3" />
        </>
      );
    case 'perpendicular':
      return <path d="M-5-5V5H5M-5 1H-1V5" />;
    case 'fix':
      return (
        <>
          <path d="M-3-1V-3a3 3 0 0 1 6 0v2" />
          <rect x="-4.5" y="-1" width="9" height="7" rx="1" />
        </>
      );
  }
}

/** Selectable, constant-size constraint annotations rendered inside the sketch SVG. */
export function InlineConstraints({
  sketch,
  scale,
  selectedConstraintIds,
  conflictedConstraintIds = [],
  interactive = true,
  hoveredConstraintId,
  onSelect,
  onHover,
  onEdit,
}: InlineConstraintsProps) {
  const [pointerId, setPointerId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const selected = new Set(selectedConstraintIds);
  const conflicts = new Set(conflictedConstraintIds);
  const zoom = Number.isFinite(scale) && Math.abs(scale) > 1e-6 ? Math.abs(scale) : 1;
  return (
    <g className="cad-inline-constraints">
      {layoutInlineConstraints(sketch, zoom).map(glyph => {
        const active = selected.has(glyph.id);
        const conflict = conflicts.has(glyph.id);
        const highlighted = active || pointerId === glyph.key || focusId === glyph.key || hoveredConstraintId === glyph.id;
        return (
          <g
            key={glyph.key}
            data-constraint-id={glyph.id}
            data-inline-constraint={glyph.kind}
            data-conflict={conflict ? 'true' : undefined}
            role="button"
            tabIndex={interactive ? 0 : -1}
            aria-label={`${glyph.label} constraint`}
            aria-pressed={active}
            aria-disabled={!interactive}
            aria-description={conflict ? 'Conflicting constraint. Select, then Delete to remove and resolve the sketch.' : undefined}
            transform={`translate(${glyph.position.x} ${-glyph.position.y}) scale(${1 / zoom})`}
            style={{
              cursor: interactive ? 'pointer' : undefined,
              outline: 'none',
              color: active ? '#8a5c00' : conflict ? '#c43b35' : '#69727b',
              pointerEvents: interactive ? 'auto' : 'none',
            }}
            onPointerDown={event => {
              if (interactive && event.button === 0) event.stopPropagation();
            }}
            onClick={event => {
              if (!interactive) return;
              event.stopPropagation();
              event.currentTarget.focus();
              onSelect(glyph.id, event.shiftKey || event.ctrlKey || event.metaKey);
            }}
            onDoubleClick={event => {
              if (interactive) {
                event.stopPropagation();
                onEdit?.(glyph.id);
              }
            }}
            onKeyDown={event => {
              if (!interactive) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onSelect(glyph.id, event.shiftKey || event.ctrlKey || event.metaKey);
              }
            }}
            onPointerEnter={() => {
              if (interactive) {
                setPointerId(glyph.key);
                onHover?.(glyph.id, glyph.entityIds);
              }
            }}
            onPointerLeave={() => {
              setPointerId(null);
              if (interactive) onHover?.(null, []);
            }}
            onFocus={() => {
              if (interactive) {
                setFocusId(glyph.key);
                onHover?.(glyph.id, glyph.entityIds);
              }
            }}
            onBlur={() => {
              setFocusId(null);
              if (interactive) onHover?.(null, []);
            }}>
            <title>
              {conflict ? 'Conflicting ' : ''}
              {glyph.label} constraint — select, then Delete to remove
            </title>
            <rect
              x={-INLINE_CONSTRAINT_SIZE / 2}
              y={-INLINE_CONSTRAINT_SIZE / 2}
              width={INLINE_CONSTRAINT_SIZE}
              height={INLINE_CONSTRAINT_SIZE}
              rx="2"
              fill={active ? '#fff1bf' : conflict ? '#fff0ee' : highlighted ? '#fff9e2' : 'transparent'}
              stroke={active ? '#c28a19' : conflict ? '#c43b35' : highlighted ? '#c28a19' : 'none'}
              strokeWidth="1"
              pointerEvents={interactive ? 'all' : 'none'}
            />
            <g
              aria-hidden="true"
              pointerEvents="none"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round">
              <ConstraintSymbol kind={glyph.kind} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

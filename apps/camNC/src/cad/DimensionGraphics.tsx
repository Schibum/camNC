import { type CadDimension, type CadPoint, type CadSketch } from '@wbcnc/cad';
import type { PointerEvent, ReactNode } from 'react';
import { angleDimensionGeometry, dimensionAnchor, dimensionPoints, linearDimensionGeometry } from './dimensionGeometry';
import { SKETCH_APPEARANCE } from './sketchAppearance';
import { formatCadValue } from './valueExpressions';

function Decorations({
  constraint: c,
  sketch,
  at,
  scale,
  color,
}: {
  constraint: CadDimension;
  sketch: CadSketch;
  at: CadPoint;
  scale: number;
  color: string;
}) {
  const points = dimensionPoints(sketch),
    graphics: ReactNode[] = [];
  const line = (a: CadPoint, b: CadPoint, key: string) =>
    graphics.push(
      <line
        key={key}
        data-dimension-line={key}
        x1={a.x}
        y1={-a.y}
        x2={b.x}
        y2={-b.y}
        stroke={color}
        strokeWidth={0.75}
        vectorEffect="non-scaling-stroke"
      />
    );
  const arrow = (tip: CadPoint, toward: CadPoint, key: string) => {
    const length = Math.hypot(toward.x - tip.x, toward.y - tip.y);
    if (length < 1e-10) return;
    const ux = (toward.x - tip.x) / length,
      uy = (toward.y - tip.y) / length;
    const back = { x: tip.x + (ux * 6) / scale, y: tip.y + (uy * 6) / scale };
    graphics.push(
      <polygon
        key={key}
        data-dimension-arrow={key}
        fill={color}
        points={`${tip.x},${-tip.y} ${back.x - (uy * 2.5) / scale},${-(back.y + (ux * 2.5) / scale)} ${back.x + (uy * 2.5) / scale},${-(back.y - (ux * 2.5) / scale)}`}
      />
    );
  };
  const extension = (source: CadPoint, target: CadPoint, key: string, gap = 3) => {
    const length = Math.hypot(target.x - source.x, target.y - source.y);
    if (length < 1e-10) return;
    const ux = (target.x - source.x) / length,
      uy = (target.y - source.y) / length;
    line(
      { x: source.x + (ux * gap) / scale, y: source.y + (uy * gap) / scale },
      { x: target.x + (ux * 4) / scale, y: target.y + (uy * 4) / scale },
      key
    );
  };
  const linear = linearDimensionGeometry(c, sketch, at);
  if (linear) {
    const { da, db, extensionA, extensionB, labelLeader } = linear;
    if (extensionA) extension(extensionA.source, extensionA.target, 'extension-a', extensionA.continuesLine ? 0 : 3);
    if (extensionB) extension(extensionB.source, extensionB.target, 'extension-b', extensionB.continuesLine ? 0 : 3);
    line(da, db, 'measure');
    if (labelLeader) line(labelLeader[0], labelLeader[1], 'label-leader');
    arrow(da, db, 'arrow-a');
    arrow(db, da, 'arrow-b');
  } else if (c.type === 'radius' || c.type === 'diameter') {
    const entity = sketch.entities.find(e => e.id === c.entityId);
    const center = entity && 'centerId' in entity ? points.get(entity.centerId) : undefined;
    if (center && entity && 'radius' in entity) {
      const length = Math.hypot(at.x - center.x, at.y - center.y);
      if (length < 1e-10) return null;
      let angle = Math.atan2(at.y - center.y, at.x - center.x);
      if (entity.type === 'arc') {
        const wrap = (value: number) => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (wrap(angle - entity.startAngle) > wrap(entity.endAngle - entity.startAngle) + 1e-10) {
          const angularDistance = (endpoint: number) => Math.abs(Math.atan2(Math.sin(angle - endpoint), Math.cos(angle - endpoint)));
          angle = angularDistance(entity.startAngle) <= angularDistance(entity.endAngle) ? entity.startAngle : entity.endAngle;
        }
      }
      const ux = Math.cos(angle),
        uy = Math.sin(angle);
      const edge = { x: center.x + ux * entity.radius, y: center.y + uy * entity.radius };
      if (c.type === 'diameter') {
        const opposite = { x: center.x - ux * entity.radius, y: center.y - uy * entity.radius };
        line(opposite, edge, 'diameter');
        arrow(opposite, edge, 'diameter-a');
        arrow(edge, opposite, 'diameter-b');
      } else {
        line(center, edge, 'radius');
        arrow(edge, center, 'radius-arrow');
      }
      line(edge, at, 'leader');
    }
  } else if (c.type === 'angle') {
    const geometry = angleDimensionGeometry(c, sketch);
    if (geometry) {
      const { center, startAngle, sweep } = geometry,
        radius = Math.hypot(at.x - center.x, at.y - center.y);
      if (radius < 1e-10) return null;
      const endAngle = startAngle + sweep,
        direction = sweep >= 0 ? 1 : -1;
      const start = { x: center.x + radius * Math.cos(startAngle), y: center.y + radius * Math.sin(startAngle) };
      const end = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) };
      graphics.push(
        <path
          key="angle-arc"
          data-dimension-line="angle-arc"
          d={`M ${start.x} ${-start.y} A ${radius} ${radius} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 0 : 1} ${end.x} ${-end.y}`}
          fill="none"
          stroke={color}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
      );
      arrow(start, { x: start.x - Math.sin(startAngle) * direction, y: start.y + Math.cos(startAngle) * direction }, 'angle-a');
      arrow(end, { x: end.x + Math.sin(endAngle) * direction, y: end.y - Math.cos(endAngle) * direction }, 'angle-b');
    }
  }
  return (
    <g pointerEvents="none" aria-hidden="true">
      {graphics}
    </g>
  );
}

export interface DimensionGraphicsProps {
  constraint: CadDimension;
  sketch: CadSketch;
  pixelScale: number;
  position?: CadPoint;
  selected?: boolean;
  conflicted?: boolean;
  interactive?: boolean;
  /** A transient tool may supply its own editable value box at the same annotation. */
  showLabel?: boolean;
  onSelect?: (additive: boolean) => void;
  onEdit?: () => void;
  onLabelPointerDown?: (event: PointerEvent<SVGGElement>) => void;
}

export function DimensionGraphics({
  constraint,
  sketch,
  pixelScale,
  position,
  selected = false,
  conflicted = false,
  interactive = true,
  showLabel = true,
  onSelect,
  onEdit,
  onLabelPointerDown,
}: DimensionGraphicsProps) {
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const at = position ?? dimensionAnchor(constraint, sketch, scale);
  if (!at) return null;
  const formatted = formatCadValue(constraint.value),
    expression = constraint.expression?.trim();
  const text = `${expression ? 'ƒ ' : ''}${constraint.type === 'diameter' ? '⌀' : constraint.type === 'radius' ? 'R' : ''}${formatted}${constraint.type === 'angle' ? '°' : ''}`;
  const color = selected
    ? SKETCH_APPEARANCE.selectedColor
    : conflicted
      ? '#c73535'
      : constraint.driven
        ? '#718096'
        : SKETCH_APPEARANCE.constrainedColor;
  const width = Math.max(32, text.length * 8 + 14) / scale;
  return (
    <>
      <Decorations constraint={constraint} sketch={sketch} at={at} scale={scale} color={color} />
      {showLabel && (
        <g
          data-dimension={constraint.id}
          data-dimension-driven={constraint.driven || undefined}
          data-dimension-expression={expression ? true : undefined}
          className="cad-canvas-dimension"
          style={{ pointerEvents: interactive ? 'all' : 'none' }}
          role="button"
          aria-disabled={!interactive}
          tabIndex={interactive ? 0 : -1}
          aria-label={`${constraint.driven ? 'Reference' : 'Edit'} ${constraint.label ?? constraint.type}: ${formatted} ${constraint.type === 'angle' ? 'degrees' : 'mm'}`}
          aria-description={
            [constraint.driven ? 'Read-only measurement that follows the geometry.' : '', expression ? `Expression: ${expression}` : '']
              .filter(Boolean)
              .join(' ') || undefined
          }
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.stopPropagation();
            if (interactive) onLabelPointerDown?.(event);
          }}
          onClick={event => {
            event.stopPropagation();
            if (interactive) onSelect?.(event.shiftKey || event.ctrlKey || event.metaKey);
          }}
          onDoubleClick={event => {
            event.stopPropagation();
            if (interactive && !constraint.driven) onEdit?.();
          }}
          onKeyDown={event => {
            if (!interactive) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === 'Enter' && !constraint.driven) onEdit?.();
              else onSelect?.(event.shiftKey || event.ctrlKey || event.metaKey);
            }
          }}>
          <rect
            x={at.x - width / 2}
            y={-at.y - 11 / scale}
            width={width}
            height={22 / scale}
            rx={2 / scale}
            fill={conflicted && !selected ? '#fff0f0' : 'white'}
            fillOpacity={0.95}
            stroke={selected || conflicted ? color : 'none'}
            strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
          />
          <text x={at.x} y={-at.y + 5 / scale} textAnchor="middle" fill={color} fontSize={14 / scale} pointerEvents="none">
            {text}
          </text>
        </g>
      )}
    </>
  );
}

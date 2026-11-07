import {
  evaluateCurvePoint,
  isNurbsCurve,
  isOwnedSplineHandle,
  visibleSketchPointIds,
  type CadEntity,
  type CadEntityFreedom,
} from '@wbcnc/cad';
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode, type SVGProps } from 'react';
import { SKETCH_APPEARANCE, sketchArcPath, sketchCurvePath } from './sketchAppearance';
import { formatCadValue } from './valueExpressions';

export interface SketchGeometryProps {
  entities: readonly CadEntity[];
  selectedIds: readonly string[];
  /** Constraint state color, supplied by the editor's solver feedback. */
  stroke?: string;
  /** Per-source native rank results; unknown entities remain blue instead of claiming full constraint. */
  entityStatus?: Readonly<Record<string, CadEntityFreedom>>;
  pixelScale: number;
  hoveredPointId?: string | null;
  interactive?: boolean;
  onEditConic?: (entityId: string) => void;
}

export function SketchGeometry({
  entities,
  selectedIds,
  stroke = SKETCH_APPEARANCE.freeColor,
  entityStatus,
  pixelScale,
  hoveredPointId,
  interactive = false,
  onEditConic,
}: SketchGeometryProps) {
  const points = new Map(entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const visible = visibleSketchPointIds({ id: 'render', entities: [...entities], constraints: [] }, selectedIds);
  const bezierControls = new Set(entities.flatMap(e => (e.type === 'bezier' ? e.controlPointIds : [])));
  const conicControls = new Set(entities.flatMap(e => (e.type === 'conic' ? [e.controlId] : [])));
  const tangentOwners = new Set(entities.filter(isOwnedSplineHandle).map(e => e.owner.splineId));
  const handlePoints = new Map<string, { splineId: string; end: 'start' | 'end' }>(
    entities.flatMap(entity =>
      entity.type === 'spline' && !entity.closed
        ? ([
            [entity.controlPointIds[1]!, { splineId: entity.id, end: 'start' }],
            [entity.controlPointIds.at(-2)!, { splineId: entity.id, end: 'end' }],
          ] as const)
        : []
    )
  );
  const curves = entities.filter(entity => entity.type !== 'point');
  // Handle hit areas sit above their parent curve, including nearly coincident tangents.
  const drawnCurves = [...curves.filter(entity => !isOwnedSplineHandle(entity)), ...curves.filter(isOwnedSplineHandle)];
  const entityColor = (id: string) =>
    entityStatus ? (entityStatus[id] === 'fully-constrained' ? SKETCH_APPEARANCE.constrainedColor : SKETCH_APPEARANCE.freeColor) : stroke;
  return (
    <>
      {drawnCurves.map(entity => {
        const selected = selectedIds.includes(entity.id);
        const handle = isOwnedSplineHandle(entity) ? entity.owner : undefined;
        const props = {
          stroke: selected
            ? SKETCH_APPEARANCE.selectedColor
            : entity.construction
              ? SKETCH_APPEARANCE.constructionColor
              : entityColor(entity.id),
          strokeWidth: selected ? SKETCH_APPEARANCE.selectedStroke : handle ? 1 : SKETCH_APPEARANCE.normalStroke,
          fill: 'none',
          vectorEffect: 'non-scaling-stroke' as const,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          strokeDasharray: entity.construction && !handle ? SKETCH_APPEARANCE.constructionDash : undefined,
        };
        let shape: ReactElement<SVGProps<SVGElement>> | undefined;
        if (entity.type === 'line') {
          const start = points.get(entity.startId),
            end = points.get(entity.endId);
          if (start && end) shape = <line x1={start.x} y1={-start.y} x2={end.x} y2={-end.y} {...props} />;
        } else if (entity.type === 'circle') {
          const center = points.get(entity.centerId);
          if (center) shape = <circle cx={center.x} cy={-center.y} r={entity.radius} {...props} />;
        } else if (entity.type === 'arc') shape = <path d={sketchArcPath(entity, points)} {...props} />;
        else if (isNurbsCurve(entity)) shape = <path d={sketchCurvePath(entity, points, scale)} {...props} />;
        return (
          <g
            key={entity.id}
            data-entity-id={entity.id}
            data-constraint-status={entityStatus?.[entity.id]}
            className="cad-entity"
            data-spline-id={handle?.splineId}
            data-spline-handle-segment={handle?.end}
            data-spline-tangents={handle?.splineId}>
            <title>
              {entity.type}
              {entity.construction ? ' (construction)' : ''}
            </title>
            {shape && handle && entity.type === 'line' ? (
              <path
                d={`M ${points.get(entity.startId)!.x} ${-points.get(entity.startId)!.y} L ${points.get(entity.endId)!.x} ${-points.get(entity.endId)!.y}`}
                fill="none"
                stroke="transparent"
                strokeWidth={SKETCH_APPEARANCE.curveHitStroke}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              shape &&
              cloneElement(shape, { stroke: 'transparent', strokeWidth: SKETCH_APPEARANCE.curveHitStroke, strokeDasharray: undefined })
            )}
            {shape && cloneElement(shape, { 'data-visible-curve': true } as SVGProps<SVGElement>)}
          </g>
        );
      })}
      {[...points.values()].map(point => {
        if (!visible.has(point.id)) return null;
        const selected = selectedIds.includes(point.id);
        const handle = handlePoints.get(point.id);
        const hollow = ((point.construction && !conicControls.has(point.id)) || bezierControls.has(point.id)) && !point.fixed;
        return (
          <g key={point.id} data-entity-id={point.id} data-spline-id={handle?.splineId} data-spline-handle-point={handle?.end}>
            <circle cx={point.x} cy={-point.y} r={SKETCH_APPEARANCE.pointHitRadius / scale} fill="transparent" />
            <circle
              data-entity-id={point.id}
              cx={point.x}
              cy={-point.y}
              r={(selected ? SKETCH_APPEARANCE.selectedPointRadius : SKETCH_APPEARANCE.pointRadius) / scale}
              data-constraint-status={entityStatus?.[point.id]}
              fill={
                hollow
                  ? '#fff'
                  : selected
                    ? SKETCH_APPEARANCE.selectedColor
                    : point.fixed
                      ? SKETCH_APPEARANCE.fixedPointColor
                      : entityColor(point.id)
              }
              stroke={hollow ? (selected ? SKETCH_APPEARANCE.selectedColor : entityColor(point.id)) : undefined}
              strokeWidth={hollow ? 1 : undefined}
              vectorEffect="non-scaling-stroke"
              className="cad-point">
              <title>
                {point.fixed ? 'Fixed point' : 'Point'} {formatCadValue(point.x)}, {formatCadValue(point.y)}
              </title>
            </circle>
            {hoveredPointId === point.id && (
              <circle
                cx={point.x}
                cy={-point.y}
                r={SKETCH_APPEARANCE.hoverRadius / scale}
                fill="none"
                stroke={SKETCH_APPEARANCE.selectedColor}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
      {entities
        .filter(e => isNurbsCurve(e) && (selectedIds.includes(e.id) || e.type === 'bezier'))
        .map(entity => {
          if (!isNurbsCurve(entity)) return null;
          const ids = entity.type === 'conic' ? [entity.startId, entity.controlId, entity.endId] : entity.controlPointIds;
          return entity.type !== 'bezier' ? null : (
            <polyline
              key={`controls:${entity.id}`}
              data-control-polygon={entity.id}
              points={ids
                .map(id => points.get(id))
                .filter(p => !!p)
                .map(p => `${p.x},${-p.y}`)
                .join(' ')}
              stroke="#222"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
              pointerEvents="none"
            />
          );
        })}
      {entities
        .filter(e => e.type === 'spline' && !e.closed && !tangentOwners.has(e.id))
        .map(entity => {
          if (entity.type !== 'spline') return null;
          return (
            <g key={`tangents:${entity.id}`} data-spline-tangents={entity.id} pointerEvents="none">
              {[
                [entity.startId, entity.controlPointIds[1]!],
                [entity.endId, entity.controlPointIds.at(-2)!],
              ].map(([a, b], i) => {
                const start = points.get(a!),
                  end = points.get(b!);
                return start && end ? (
                  <line
                    key={i}
                    x1={start.x}
                    y1={-start.y}
                    x2={end.x}
                    y2={-end.y}
                    stroke={SKETCH_APPEARANCE.constructionColor}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null;
              })}
            </g>
          );
        })}
      {entities
        .filter(e => e.type === 'conic')
        .map(entity => {
          if (entity.type !== 'conic') return null;
          let anchor;
          try {
            anchor = evaluateCurvePoint(entity, points, 0.5);
          } catch {
            return null;
          }
          const enabled = interactive && !!onEditConic;
          return (
            <g
              key={`rho:${entity.id}`}
              data-conic-rho={entity.id}
              role={enabled ? 'button' : undefined}
              aria-label={enabled ? `Edit conic rho: ${formatCadValue(entity.rho)}` : undefined}
              tabIndex={enabled ? 0 : -1}
              transform={`translate(${anchor.x + 12 / scale},${-anchor.y - 12 / scale}) scale(${1 / scale})`}
              pointerEvents={enabled ? 'all' : 'none'}
              onPointerDown={
                enabled
                  ? event => {
                      if (event.button === 0) event.stopPropagation();
                    }
                  : undefined
              }
              onClick={enabled ? event => event.stopPropagation() : undefined}
              onDoubleClick={
                enabled
                  ? event => {
                      event.stopPropagation();
                      onEditConic?.(entity.id);
                    }
                  : undefined
              }
              onKeyDown={
                enabled
                  ? event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        onEditConic?.(entity.id);
                      }
                    }
                  : undefined
              }>
              <rect x="-4" y="-16" width="58" height="23" fill="#fff" fillOpacity=".9" />
              <text fontSize="13" fill="#111">
                ρ {formatCadValue(entity.rho)}
              </text>
            </g>
          );
        })}
    </>
  );
}

/** Apply preview appearance to drawable leaves; vector-effect is not inherited from SVG groups. */
export function SketchPreview({
  children,
  construction = false,
}: {
  children: ReactElement<SVGProps<SVGElement>>;
  construction?: boolean;
}) {
  const styleShapes = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, child => {
      if (!isValidElement<SVGProps<SVGElement>>(child)) return child;
      const drawable =
        typeof child.type === 'string' && ['line', 'rect', 'circle', 'ellipse', 'path', 'polyline', 'polygon'].includes(child.type);
      return cloneElement(child, {
        ...(drawable && {
          stroke: SKETCH_APPEARANCE.previewColor,
          strokeWidth: SKETCH_APPEARANCE.previewStroke,
          vectorEffect: 'non-scaling-stroke',
          // Control polygons have their own dash pattern, independent of construction geometry.
          strokeDasharray: child.props.strokeDasharray ?? (construction ? SKETCH_APPEARANCE.constructionDash : undefined),
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: 'none',
        }),
        ...(child.props.children !== undefined && { children: styleShapes(child.props.children) }),
      });
    });
  return (
    <g className="cad-preview" pointerEvents="none">
      {styleShapes(children)}
    </g>
  );
}

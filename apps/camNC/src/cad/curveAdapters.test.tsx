import {
  addBezier,
  addConic,
  addConstraint,
  addSpline,
  createCadPart,
  evaluateCurvePoint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SketchGeometry } from './SketchGeometry';
import { pickBezierControlPolygon, pickSketchPoint, pickSketchSnap } from './picking';
import { dragTargets } from './drag';
import { layoutInlineConstraints, removeInlineConstraint } from './inlineConstraintLayout';
import { buildConstraintForSelection } from './constraintCommands';
afterEach(cleanup);
const map = (s: CadSketch) => new Map(s.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
const project = (p: { x: number; y: number }) => ({ x: p.x * 2 + 20, y: 200 - p.y * 2 });
describe('analytic curve editor adapters', () => {
  it('renders true curved paths and exposes conic and independent spline tangent controls by default', () => {
    let s = addConic(createCadPart().sketch, { start: { x: 10, y: 0 }, end: { x: 90, y: 0 }, control: { x: 50, y: 70 }, rho: 0.7 });
    const conic = s.entities.at(-1)!;
    if (conic.type !== 'conic') throw Error();
    s = addSpline(s, {
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 30 },
        { x: 70, y: 35 },
        { x: 100, y: 0 },
      ],
    });
    const spline = s.entities.at(-1)!;
    if (spline.type !== 'spline') throw Error();
    const { container } = render(
      <svg>
        <SketchGeometry entities={s.entities} selectedIds={[]} pixelScale={2} />
      </svg>
    );
    expect(container.querySelector(`g[data-entity-id="${conic.id}"] path`)!.getAttribute('d')).toContain('L');
    const control = container.querySelector(`circle.cad-point[data-entity-id="${conic.controlId}"]`)!;
    expect(control.getAttribute('fill')).toBe('#0000ff');
    expect(container.querySelector(`circle.cad-point[data-entity-id="${spline.controlPointIds[1]}"]`)!.getAttribute('fill')).toBe('#fff');
    expect(container.querySelector(`circle.cad-point[data-entity-id="${spline.controlPointIds[2]}"]`)).toBeNull();
    expect(container.querySelector(`[data-spline-tangents="${spline.id}"]`)).not.toBeNull();
  });
  it('shows all Bezier controls and polygon without requiring selection; curve drags include every source pole', () => {
    const s = addBezier(createCadPart().sketch, {
        points: [
          { x: 10, y: 0 },
          { x: 40, y: 60 },
          { x: 70, y: -10 },
          { x: 100, y: 0 },
        ],
      }),
      curve = s.entities.at(-1)!;
    if (curve.type !== 'bezier') throw Error();
    const { container } = render(
      <svg>
        <SketchGeometry entities={s.entities} selectedIds={[]} pixelScale={2} />
      </svg>
    );
    expect(container.querySelector(`[data-control-polygon="${curve.id}"]`)).not.toBeNull();
    for (const id of curve.controlPointIds)
      expect(container.querySelector(`circle.cad-point[data-entity-id="${id}"]`)!.getAttribute('fill')).toBe('#fff');
    expect(dragTargets(s, [curve.id], { x: 5, y: 10 }).map(p => p.pointId)).toEqual(curve.controlPointIds);
  });
  it('picks normalized analytic curve contact after affine projection and suppresses hidden derived spline poles', () => {
    const s = addSpline(createCadPart().sketch, {
        points: [
          { x: 0, y: 0 },
          { x: 35, y: 40 },
          { x: 75, y: 10 },
          { x: 110, y: 0 },
        ],
      }),
      curve = s.entities.at(-1)!;
    if (curve.type !== 'spline') throw Error();
    const points = map(s),
      p = evaluateCurvePoint(curve, points, 0.45),
      screen = project(p);
    const hit = pickSketchSnap(s, screen, { project, pointRadiusPx: 0.1, includeMidpoints: false });
    expect(hit?.kind).toBe('pointOnCurve');
    expect(hit?.parameter).toBeCloseTo(0.45, 6);
    expect(hit?.point.x).toBeCloseTo(p.x, 6);
    const hidden = points.get(curve.controlPointIds[2]!)!;
    expect(pickSketchPoint(s, project(hidden), { project, pointRadiusPx: 0.01 })).toBeNull();
    expect(pickSketchPoint(s, project(hidden), { project, pointRadiusPx: 0.01, selectedEntityIds: [curve.id] })).toBeNull();
  });
  it('keeps conic rho annotation passive while drawing and edits only by explicit double-click or Enter', () => {
    const s = addConic(createCadPart().sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 50, y: 70 } }),
      curve = s.entities.at(-1)!;
    const edit = vi.fn();
    const { container, rerender } = render(
      <svg>
        <SketchGeometry entities={s.entities} selectedIds={[]} pixelScale={2} onEditConic={edit} />
      </svg>
    );
    expect(container.querySelector('[data-conic-rho]')!.getAttribute('pointer-events')).toBe('none');
    rerender(
      <svg>
        <SketchGeometry entities={s.entities} selectedIds={[]} pixelScale={2} onEditConic={edit} interactive />
      </svg>
    );
    const label = container.querySelector('[data-conic-rho]')!;
    fireEvent.click(label);
    expect(edit).not.toHaveBeenCalled();
    fireEvent.doubleClick(label);
    expect(edit).toHaveBeenLastCalledWith(curve.id);
    fireEvent.keyDown(label, { key: 'Enter' });
    expect(edit).toHaveBeenCalledTimes(2);
  });
  it('creates, renders, and removes native point-on-curve relations without changing geometry', () => {
    let s = addConic(createCadPart().sketch, { start: { x: 10, y: 0 }, end: { x: 100, y: 0 }, control: { x: 50, y: 60 } });
    const curve = s.entities.at(-1)!;
    const p = s.entities.find(e => e.type === 'point' && e.fixed)!;
    const command = buildConstraintForSelection(s, 'coincident', [p.id, curve.id]);
    expect(command.constraint?.type).toBe('pointOnCurve');
    s = addConstraint(s, command.constraint!);
    const glyphs = layoutInlineConstraints(s, 2);
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]!.label).toBe('Point on curve');
    const removed = removeInlineConstraint(s, s.constraints[0]!.id);
    expect(removed.constraints).toHaveLength(0);
    expect(removed.entities).toEqual(s.entities);
  });
  it.each([0.25, 1, 8])('picks the visible Bezier control polygon in CSS pixels at scale %s and protects its vertices', scale => {
    const s = addBezier(createCadPart().sketch, {
        points: [
          { x: 20, y: 20 },
          { x: 40, y: 105 },
        ],
      }),
      curve = s.entities.at(-1)!;
    const project = (p: { x: number; y: number }) => ({ x: p.x * scale + 100, y: 400 - p.y * scale }),
      middle = project({ x: 30, y: 62.5 });
    const hit = pickBezierControlPolygon(s, middle, { project });
    expect(hit).toMatchObject({ kind: 'segment', entityId: curve.id, distancePx: 0 });
    const a = project({ x: 20, y: 20 }),
      b = project({ x: 40, y: 105 }),
      length = Math.hypot(b.x - a.x, b.y - a.y),
      normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    expect(pickBezierControlPolygon(s, { x: middle.x + normal.x * 7.9, y: middle.y + normal.y * 7.9 }, { project })?.kind).toBe('segment');
    expect(pickBezierControlPolygon(s, { x: middle.x + normal.x * 8.1, y: middle.y + normal.y * 8.1 }, { project })).toBeNull();
    expect(pickBezierControlPolygon(s, a, { project })).toMatchObject({
      kind: 'vertex',
      vertexId: curve.type === 'bezier' ? curve.controlPointIds[0] : '',
    });
  });
});

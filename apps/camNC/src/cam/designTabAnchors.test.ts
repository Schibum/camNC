import {
  addConic,
  addLine,
  createCadDocument,
  createCadPart,
  setConicRho,
  constraintEntityIds,
  createPlateDocument,
  evaluateCadDocument,
  type CadSolveResult,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { newBoard } from './boards';
import { carryDesignTabs } from './designTabAnchors';

describe('CAD tab boundary lineage', () => {
  it.each([
    { issue: 'The design changed after cutting. Reset or place this part’s tabs for the new setup.', retained: false },
    { issue: 'A tab boundary changed. Reset or place this part’s tabs again on Boards.', retained: true },
  ])('clears only obsolete cut-source notices while retaining real anchor repairs: %j', ({ issue, retained }) => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const changed = structuredClone(document);
    changed.parts[0]!.sketch.entities = changed.parts[0]!.sketch.entities.map(entity =>
      entity.type === 'point' && entity.x === 100 ? { ...entity, x: 120 } : entity
    );
    const result = (source: typeof document): CadSolveResult => ({
      ...evaluateCadDocument(source),
      document: source,
      status: 'solved',
      sketches: [],
    });
    const instance = `${document.parts[0]!.id}#0`;
    const board = {
      ...newBoard([], 12, 'plywood', [instance]),
      tabsAt: { [instance]: [{ x: 30, y: 0 }] },
      cut: { at: 1, keys: [], startedKeys: ['program-A'], sourceKey: 'physical-source-A' },
      designIssues: { [instance]: issue },
    };
    const carried = carryDesignTabs([board], result(changed), result(document), { [board.id]: 'physical-source-A' })![0]!;
    expect(carried.tabsAt).toEqual(board.tabsAt);
    expect(carried.cut).toEqual(board.cut);
    expect(carried.designIssues).toEqual(retained ? board.designIssues : undefined);
  });

  it('retains changed-source tab repair state if an unrequested preparation rolls back', () => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const changed = structuredClone(document);
    changed.parts[0]!.sketch.entities = changed.parts[0]!.sketch.entities.map(entity =>
      entity.type === 'point' && entity.x === 100 ? { ...entity, x: 120 } : entity
    );
    const result = (source: typeof document): CadSolveResult => ({
      ...evaluateCadDocument(source),
      document: source,
      status: 'solved',
      sketches: [],
    });
    const instance = `${document.parts[0]!.id}#0`;
    const board = {
      ...newBoard([], 12, 'plywood', [instance]),
      tabsAt: { [instance]: [{ x: 100, y: 30 }] },
      cut: { at: 1, keys: [], startedKeys: ['preparation-A'], sourceKey: 'physical-source-A' },
    };
    const altered = carryDesignTabs([board], result(document), result(changed), { [board.id]: 'physical-source-B' })![0]!;
    expect(altered.designIssues![instance]).toMatch(/changed after cutting/i);
    const rolledBack = { ...altered, cut: undefined };
    const editable = carryDesignTabs([rolledBack], result(changed), result(changed), { [board.id]: 'physical-source-B' })![0]!;
    expect(editable.designIssues).toEqual(altered.designIssues);
    expect(editable.tabsAt).toEqual(board.tabsAt);
  });

  it('keeps keyless physical stock conservative instead of assuming that a later shape proves its source', () => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const changed = structuredClone(document);
    changed.parts[0]!.sketch.entities = changed.parts[0]!.sketch.entities.map(entity =>
      entity.type === 'point' && entity.x === 100 ? { ...entity, x: 120 } : entity
    );
    const result = (source: typeof document): CadSolveResult => ({
      ...evaluateCadDocument(source),
      document: source,
      status: 'solved',
      sketches: [],
    });
    const instance = `${document.parts[0]!.id}#0`;
    const board = {
      ...newBoard([], 12, 'plywood', [instance]),
      tabsAt: { [instance]: [{ x: 30, y: 0 }] },
      cut: { at: 1, keys: ['program-A'] },
    };
    const altered = carryDesignTabs([board], result(document), result(changed))![0]!;
    expect(altered.designIssues![instance]).toMatch(/changed after cutting/i);
    const reverted = carryDesignTabs([altered], result(changed), result(document))![0]!;
    expect(reverted.designIssues).toEqual(altered.designIssues);
    expect(reverted.tabsAt).toEqual(board.tabsAt);
  });

  it('retains a tab at its normalized analytic conic parameter when rho changes', () => {
    const document = createCadDocument(),
      part = createCadPart('Conic', 12);
    part.sketch = addConic(part.sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 50, y: 60 } });
    const conic = part.sketch.entities.at(-1)!;
    part.sketch = addLine(part.sketch, { x1: 100, y1: 0, x2: 0, y2: 0 });
    document.parts.push(part);
    const edited = structuredClone(document);
    edited.parts[0]!.sketch = setConicRho(edited.parts[0]!.sketch, conic.id, 0.7);
    const result = (source: typeof document): CadSolveResult => ({
      ...evaluateCadDocument(source),
      document: source,
      status: 'solved',
      sketches: [],
    });
    const instance = `${part.id}#0`,
      board = { ...newBoard([], 12, 'plywood', [instance]), tabsAt: { [instance]: [{ x: 50, y: 30 }] } };
    const carried = carryDesignTabs([board], result(document), result(edited))![0];
    expect(carried.designIssues).toBeUndefined();
    expect(carried.tabsAt![instance][0].x).toBeCloseTo(50, 5);
    expect(carried.tabsAt![instance][0].y).toBeCloseTo(42, 5);
  });
  it('requires repair after trimming a surviving curve and closing the outline with new curves', () => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const edited = structuredClone(document);
    const part = edited.parts[0];
    const bottom = part.sketch.entities.find(e => e.type === 'line')!;
    if (bottom.type !== 'line') throw new Error('Expected a rectangle boundary');
    const oldEnd = bottom.endId;
    // A trim removes the old curve's constraints and retains its ID for the first interval.
    // New lines then close a new outer profile.
    part.sketch.constraints = part.sketch.constraints.filter(constraint => !constraintEntityIds(constraint).includes(bottom.id));
    bottom.endId = 'trim-end';
    part.sketch.entities.push(
      { id: 'trim-end', type: 'point', x: 50, y: 0 },
      { id: 'lower-left', type: 'point', x: 50, y: -10 },
      { id: 'lower-right', type: 'point', x: 100, y: -10 },
      { id: 'closing-1', type: 'line', startId: 'trim-end', endId: 'lower-left' },
      { id: 'closing-2', type: 'line', startId: 'lower-left', endId: 'lower-right' },
      { id: 'closing-3', type: 'line', startId: 'lower-right', endId: oldEnd }
    );
    const beforeGeometry = evaluateCadDocument(document),
      afterGeometry = evaluateCadDocument(edited);
    expect(beforeGeometry.diagnostics).toEqual([]);
    expect(afterGeometry.diagnostics).toEqual([]);
    expect(afterGeometry.parts[0].loops[0].entityIds).toContain(bottom.id);
    expect(afterGeometry.parts[0].loops[0].id).not.toBe(beforeGeometry.parts[0].loops[0].id);
    const result = (source: typeof document, geometry: typeof beforeGeometry): CadSolveResult => ({
      ...geometry,
      document: source,
      status: 'solved',
      sketches: [],
    });
    const instance = `${part.id}#0`;
    const board = {
      ...newBoard([], 12, 'plywood', [instance]),
      tabsAt: { [instance]: [{ x: 80, y: 0 }] },
    };
    const carried = carryDesignTabs([board], result(document, beforeGeometry), result(edited, afterGeometry))![0];
    expect(carried.tabsAt).toEqual(board.tabsAt);
    expect(carried.designIssues![instance]).toMatch(/tab boundary changed/i);
  });
});

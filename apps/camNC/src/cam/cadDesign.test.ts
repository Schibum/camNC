import { addCircle, addRectangle, createCadDocument, createCadPart, createPlateDocument, updateDimension } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { acceptDesign, boardGeometryKey, hasDesignDraft, saveDesignDraft } from './cadDesign';
import { createDesignJob, getJob, getModelBytes, modelKey, saveJob } from './jobDb';
import { newBoard } from './boards';
import { kDefaultPlan } from './planSettings';

async function plateJob() {
  const job = await createDesignJob('Test plate');
  const document = { ...createPlateDocument({ width: 100, height: 60, thickness: 12 }), id: job.design!.draft.id };
  const drafted = await saveDesignDraft(job, document);
  return acceptDesign(drafted, document);
}

describe('native design revisions', () => {
  it('treats a restored accepted source as clean despite its newer undo-session revision', async () => {
    const first = await plateJob();
    const restored = { ...structuredClone(first.design!.accepted!), revision: first.design!.draft.revision + 100 };
    const saved = await saveDesignDraft(first, restored);
    expect(saved.design!.draft.revision).toBe(restored.revision);
    expect(hasDesignDraft(saved)).toBe(false);
    const accepted = await acceptDesign(saved, restored);
    expect(accepted.design!.acceptedRevision).toBe(first.design!.acceptedRevision);
    const width = accepted.design!.draft.parts[0]!.sketch.constraints.find(c => c.type === 'distanceX')!;
    const changed = updateDimension(accepted.design!.draft, width.id, 110);
    expect(hasDesignDraft(await saveDesignDraft(accepted, changed))).toBe(true);
    // Content equality for status must not weaken optimistic save guards against a stale editor.
    await expect(saveDesignDraft(first, changed)).rejects.toThrow(/changed/);
  });
  it('autosaves drafts without changing accepted geometry, settings, or generated-plan keys', async () => {
    const first = await plateJob();
    const part = first.design!.accepted!.parts[0];
    const width = part.sketch.constraints.find(c => c.type === 'distanceX')!;
    const board = {
      ...newBoard([], 12, 'plywood', [`${part.id}#0`]),
      layout: { w: 180, h: 140, at: { [`${part.id}#0`]: { x: 20, y: 20, rotated: false } } },
      fixtures: [{ kind: 'screw' as const, x: 9, y: 9 }],
      tabsAt: { [`${part.id}#0`]: [{ x: 40, y: 0 }] },
      bed: { a: { x: 200, y: 300, deg: 2 } },
    };
    const configured = await saveJob({ ...first, boards: [board], plan: { ...kDefaultPlan, material: 'plywood', cutBelow: 0.6 } });
    const document = updateDimension(configured.design!.draft, width.id, 130);
    const drafted = await saveDesignDraft(configured, document);
    expect(modelKey(drafted)).toBe(modelKey(configured));
    expect(boardGeometryKey(drafted, [part.id])).toBe(boardGeometryKey(configured, [part.id]));
    expect(drafted.design!.accepted).toEqual(configured.design!.accepted);
    expect((await getJob(drafted.id))!.design!.draft).toEqual(document);

    const accepted = await acceptDesign(drafted, document);
    expect(modelKey(accepted)).not.toBe(modelKey(configured));
    expect(boardGeometryKey(accepted, [part.id])).not.toBe(boardGeometryKey(configured, [part.id]));
    expect(accepted.design!.accepted!.parts[0].id).toBe(part.id);
    const { tabsAt, ...boardSettings } = board;
    expect(accepted.boards![0]).toMatchObject(boardSettings);
    expect(Object.keys(accepted.boards![0].tabsAt!)).toEqual(Object.keys(tabsAt));
    const mappedTabs = accepted.boards![0].tabsAt![`${part.id}#0`];
    expect(mappedTabs).toHaveLength(1);
    expect(mappedTabs[0].x).toBeCloseTo(52, 8);
    expect(mappedTabs[0].y).toBeCloseTo(0, 8);
    expect(accepted.plan).toEqual(configured.plan);
    expect(await getModelBytes(accepted.id)).toBeNull();
  });

  it('keeps invalid sketches editable and prevents stale draft writes after acceptance', async () => {
    const first = await plateJob();
    const width = first.design!.draft.parts[0].sketch.constraints.find(c => c.type === 'distanceX')!;
    const invalid = updateDimension(first.design!.draft, width.id, 0);
    const drafted = await saveDesignDraft(first, invalid);
    await expect(acceptDesign(drafted, invalid)).rejects.toThrow();
    expect((await getJob(first.id))!.design!.accepted).toEqual(first.design!.accepted);
    const repaired = updateDimension(invalid, width.id, 120);
    const saved = await saveDesignDraft(drafted, repaired);
    const accepted = await acceptDesign(saved, repaired);
    await expect(saveDesignDraft(first, invalid)).rejects.toThrow(/changed/);
    expect((await getJob(first.id))!.design!.acceptedRevision).toBe(accepted.design!.acceptedRevision);
  });

  it('does not overwrite a concurrently saved CAM choice when accepting a sketch', async () => {
    const first = await plateJob();
    const width = first.design!.draft.parts[0].sketch.constraints.find(c => c.type === 'distanceX')!;
    const document = updateDimension(first.design!.draft, width.id, 110);
    const drafted = await saveDesignDraft(first, document);
    await saveJob({ ...drafted, plan: { ...kDefaultPlan, material: 'mdf', cutBelow: 0.8 } });
    const accepted = await acceptDesign(drafted, document);
    expect(accepted.plan).toMatchObject({ material: 'mdf', cutBelow: 0.8 });
  });

  it('keeps geometry revisions for part renames and dimension label changes', async () => {
    const first = await plateJob();
    const document = structuredClone(first.design!.draft);
    document.parts[0].name = 'Renamed plate';
    document.parts[0].sketch.constraints[0].label = 'A helpful label';
    document.revision++;
    const drafted = await saveDesignDraft(first, document);
    const accepted = await acceptDesign(drafted, document);
    expect(accepted.design!.partRevisions).toEqual(first.design!.partRevisions);
    expect(boardGeometryKey(accepted, [document.parts[0].id])).toBe(boardGeometryKey(first, [document.parts[0].id]));
    expect(accepted.parts[0].name).toBe('Renamed plate');
  });

  it('keeps the CAM placement authoritative when an explicitly positioned left boundary changes', async () => {
    const job = await createDesignJob();
    const document = { ...createCadDocument(), id: job.design!.draft.id };
    const part = createCadPart('Offset plate', 12);
    part.sketch = addRectangle(part.sketch, { x: 20, y: 10, width: 100, height: 60, dimensioned: true, positioned: true });
    part.sketch = addCircle(part.sketch, { x: 60, y: 40, radius: 4, dimensioned: true, positioned: true });
    document.parts.push(part);
    const drafted = await saveDesignDraft(job, document);
    const first = await acceptDesign(drafted, document);
    const instance = `${part.id}#0`;
    const board = {
      ...newBoard([], 12, 'plywood', [instance]),
      layout: { w: 400, h: 400, at: { [instance]: { x: 100, y: 200, rotated: false } } },
    };
    const configured = await saveJob({ ...first, boards: [board] });
    const x = part.sketch.constraints.find(c => c.label === 'X')!;
    const width = part.sketch.constraints.find(c => c.label === 'Width')!;
    const changed = updateDimension(updateDimension(configured.design!.draft, x.id, 0), width.id, 120);
    const accepted = await acceptDesign(await saveDesignDraft(configured, changed), changed);
    expect(accepted.boards![0]).toEqual(board);
  });

  it('keeps a vanished tab boundary as an explicit repair while preserving the tab placement', async () => {
    const first = await plateJob();
    const old = first.design!.draft.parts[0];
    const instance = `${old.id}#0`;
    const board = { ...newBoard([], 12, 'plywood', [instance]), tabsAt: { [instance]: [{ x: 40, y: 0 }] } };
    const configured = await saveJob({ ...first, boards: [board] });
    const newGeometry = createPlateDocument({ width: 100, height: 60, thickness: 12 }).parts[0];
    const document = { ...configured.design!.draft, revision: 1, parts: [{ ...newGeometry, id: old.id }] };
    const drafted = await saveDesignDraft(configured, document);
    const accepted = await acceptDesign(drafted, document);
    expect(accepted.boards![0].tabsAt).toEqual(board.tabsAt);
    expect(accepted.boards![0].designIssues![instance]).toMatch(/tab boundary changed/i);
  });

  it('leaves references to removed parts repairable rather than assigning their settings to another part', async () => {
    const first = await plateJob();
    const old = first.design!.draft.parts[0];
    const replacement = createPlateDocument({ width: 100, height: 60, thickness: 12 }).parts[0];
    const board = newBoard([], 12, 'plywood', [`${old.id}#0`]);
    const configured = await saveJob({ ...first, boards: [board] });
    const document = { ...configured.design!.draft, revision: 1, parts: [replacement] };
    const drafted = await saveDesignDraft(configured, document);
    const accepted = await acceptDesign(drafted, document);
    expect(accepted.boards![0].items).toEqual([`${old.id}#0`]);
    expect(accepted.parts.some(p => p.id === old.id)).toBe(true);
    expect(accepted.parts.some(p => p.id === replacement.id)).toBe(true);
    expect(boardGeometryKey(accepted, [old.id])).not.toBe(boardGeometryKey(configured, [old.id]));
  });
});

import {
  addConstraint,
  createPlateDocument,
  migrateDimensionPlacements,
  resolveDimensionPlacement,
  withDimensionPlacement,
  type CadDimension,
  type CadDocument,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { acceptDesign, boardGeometryKey, hasDesignDraft, saveDesignDraft } from './cadDesign';
import { createDesignJob, getJob, modelKey, saveJob } from './jobDb';

function widthOf(document: CadDocument): CadDimension {
  const constraint = document.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width');
  if (!constraint || !('value' in constraint)) throw new Error('Expected the plate width dimension.');
  return constraint;
}

async function legacyAcceptedPlate(options: { width?: number; expression?: string } = {}) {
  const empty = await createDesignJob('Annotation migration');
  const document = { ...createPlateDocument({ width: options.width ?? 100, height: 60, thickness: 12 }), id: empty.design!.draft.id };
  widthOf(document).labelPosition = { x: 25, y: -20 };
  const first = await acceptDesign(await saveDesignDraft(empty, document), document);
  // Represent an already accepted document saved before relative annotation placement.
  const legacy = structuredClone(first.design!.accepted!);
  const width = widthOf(legacy);
  delete width.labelPlacement;
  width.labelPosition = { x: 25, y: -20 };
  if (options.expression !== undefined) width.expression = options.expression;
  const saved = await saveJob({
    ...first,
    design: { ...first.design!, draft: legacy, accepted: structuredClone(legacy) },
  });
  // Open the persisted job through the same read boundary as a reloaded view.
  const job = await getJob(saved.id);
  if (!job?.design?.accepted) throw new Error('Expected the saved accepted sketch.');
  expect(widthOf(job.design.draft).labelPosition).toEqual({ x: 25, y: -20 });
  expect(widthOf(job.design.accepted).labelPosition).toEqual({ x: 25, y: -20 });
  expect(widthOf(job.design.draft)).not.toHaveProperty('labelPlacement');
  expect(widthOf(job.design.accepted)).not.toHaveProperty('labelPlacement');
  if (options.expression !== undefined) {
    expect(widthOf(job.design.draft).expression).toBe(options.expression);
    expect(widthOf(job.design.accepted).expression).toBe(options.expression);
  }
  return { job, legacy: job.design.draft };
}

function moveWidthLabel(document: CadDocument): CadDocument {
  const next = structuredClone(document),
    part = next.parts[0]!,
    width = widthOf(next);
  part.sketch.constraints = part.sketch.constraints.map(constraint =>
    constraint.id === width.id ? withDimensionPlacement(part.sketch, width, { x: 60, y: -30 }) : constraint
  );
  next.revision++;
  return next;
}

describe('accepted annotation metadata migration', () => {
  it('keeps an accepted legacy sketch clean when only its label representation is normalized', async () => {
    const { job, legacy } = await legacyAcceptedPlate();
    const canonical = migrateDimensionPlacements(legacy);
    expect(widthOf(legacy).labelPosition).toEqual({ x: 25, y: -20 });
    expect(widthOf(canonical)).not.toHaveProperty('labelPosition');
    expect(widthOf(canonical).labelPlacement).toEqual({ kind: 'linear', fraction: 0.25, normalOffset: -20 });
    const saved = await saveDesignDraft(job, canonical);
    expect(hasDesignDraft(saved)).toBe(false);
  });

  it('persists canonical placement without advancing the accepted CAM revision or physical geometry identity', async () => {
    const { job, legacy } = await legacyAcceptedPlate();
    const canonical = migrateDimensionPlacements(legacy),
      partIds = legacy.parts.map(part => part.id),
      drafted = await saveDesignDraft(job, canonical),
      accepted = await acceptDesign(drafted, canonical);
    expect({
      revision: accepted.design!.acceptedRevision,
      model: modelKey(accepted),
      board: boardGeometryKey(accepted, partIds),
      partRevisions: accepted.design!.partRevisions,
      partGeometryKeys: accepted.design!.partGeometryKeys,
    }).toEqual({
      revision: job.design!.acceptedRevision,
      model: modelKey(job),
      board: boardGeometryKey(job, partIds),
      partRevisions: job.design!.partRevisions,
      partGeometryKeys: job.design!.partGeometryKeys,
    });
    expect(widthOf(accepted.design!.draft)).not.toHaveProperty('labelPosition');
    expect(widthOf(accepted.design!.accepted!).labelPlacement).toEqual(widthOf(canonical).labelPlacement);
    expect(hasDesignDraft(accepted)).toBe(false);
  });

  it('still treats a deliberately moved label as an edit and accepts its new placement', async () => {
    const { job, legacy } = await legacyAcceptedPlate();
    const moved = moveWidthLabel(migrateDimensionPlacements(legacy)),
      drafted = await saveDesignDraft(job, moved);
    expect(hasDesignDraft(drafted)).toBe(true);
    const accepted = await acceptDesign(drafted, moved);
    expect(accepted.design!.acceptedRevision).toBe(job.design!.acceptedRevision + 1);
    expect(modelKey(accepted)).not.toBe(modelKey(job));
    expect(
      boardGeometryKey(
        accepted,
        legacy.parts.map(part => part.id)
      )
    ).toBe(
      boardGeometryKey(
        job,
        legacy.parts.map(part => part.id)
      )
    );
    expect(widthOf(accepted.design!.accepted!).labelPlacement).toEqual(widthOf(moved).labelPlacement);
  });

  it('keeps exact optimistic guards when an old view still expects the equivalent legacy representation', async () => {
    const { job, legacy } = await legacyAcceptedPlate();
    const canonical = migrateDimensionPlacements(legacy),
      current = await saveDesignDraft(job, canonical),
      staleEdit = moveWidthLabel(canonical);
    await expect(saveDesignDraft(current, staleEdit, legacy)).rejects.toThrow(/changed in another view/);
    await expect(acceptDesign(job, legacy)).rejects.toThrow(/changed while it was being solved/);
  });

  it('normalizes a persisted base-unit literal without a dirty draft or accepted model revision', async () => {
    const { job, legacy } = await legacyAcceptedPlate({ width: 2, expression: '2mm' });
    const canonical = migrateDimensionPlacements(legacy);
    expect(widthOf(canonical).value).toBe(2);
    expect(widthOf(canonical)).not.toHaveProperty('expression');
    const drafted = await saveDesignDraft(job, canonical);
    expect(hasDesignDraft(drafted)).toBe(false);
    const accepted = await acceptDesign(drafted, canonical);
    expect(accepted.design!.acceptedRevision).toBe(job.design!.acceptedRevision);
    expect(modelKey(accepted)).toBe(modelKey(job));
    expect(
      boardGeometryKey(
        accepted,
        legacy.parts.map(part => part.id)
      )
    ).toBe(
      boardGeometryKey(
        job,
        legacy.parts.map(part => part.id)
      )
    );
    const saved = await getJob(accepted.id);
    expect(widthOf(saved!.design!.draft)).not.toHaveProperty('expression');
    expect(widthOf(saved!.design!.accepted!)).not.toHaveProperty('expression');
    expect(hasDesignDraft(saved!)).toBe(false);
  });

  it('upgrades an accepted unflagged angle frame without creating a draft or CAM revision', async () => {
    const { job, legacy } = await legacyAcceptedPlate();
    const document = migrateDimensionPlacements(legacy),
      part = document.parts[0]!,
      [first, second] = part.sketch.entities.filter(entity => entity.type === 'line'),
      partIds = legacy.parts.map(part => part.id);
    part.sketch = addConstraint(part.sketch, {
      type: 'angle',
      entityAId: first!.id,
      entityBId: second!.id,
      value: 90,
      orientation: 1,
      driven: true,
      labelPlacement: { kind: 'angle', radius: 35, angleOffset: Math.PI / 4 },
    });
    const id = part.sketch.constraints.at(-1)!.id;
    const stored = await saveJob({ ...job, design: { ...job.design!, draft: document, accepted: structuredClone(document) } });
    const reopened = (await getJob(stored.id))!;
    const oldSketch = reopened.design!.draft.parts[0]!.sketch,
      oldAngle = oldSketch.constraints.find(constraint => constraint.id === id) as CadDimension,
      oldAccepted = reopened.design!.accepted!.parts[0]!.sketch.constraints.find(constraint => constraint.id === id) as CadDimension,
      before = resolveDimensionPlacement(oldSketch, oldAngle)!;
    expect(oldAngle.labelPlacement).not.toHaveProperty('frame');
    expect(oldAccepted.labelPlacement).not.toHaveProperty('frame');
    const canonical = migrateDimensionPlacements(reopened.design!.draft),
      sketch = canonical.parts[0]!.sketch,
      angle = sketch.constraints.find(constraint => constraint.id === id) as CadDimension,
      after = resolveDimensionPlacement(sketch, angle)!;
    expect(angle.labelPlacement).toMatchObject({ kind: 'angle', frame: 'local' });
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
    const drafted = await saveDesignDraft(reopened, canonical);
    expect(hasDesignDraft(drafted)).toBe(false);
    const accepted = await acceptDesign(drafted, canonical);
    expect(accepted.design!.acceptedRevision).toBe(reopened.design!.acceptedRevision);
    expect(modelKey(accepted)).toBe(modelKey(reopened));
    expect(boardGeometryKey(accepted, partIds)).toBe(boardGeometryKey(reopened, partIds));
    const saved = (await getJob(accepted.id))!;
    expect(saved.design!.accepted!.parts[0]!.sketch.constraints.find(constraint => constraint.id === id)).toMatchObject({
      labelPlacement: { kind: 'angle', frame: 'local' },
    });
    expect(hasDesignDraft(saved)).toBe(false);
  });

  it('keeps an intentional arithmetic expression as an accepted source edit', async () => {
    const { job, legacy } = await legacyAcceptedPlate({ width: 50 });
    const changed = migrateDimensionPlacements(legacy);
    widthOf(changed).expression = '20+30';
    changed.revision++;
    const drafted = await saveDesignDraft(job, changed);
    expect(hasDesignDraft(drafted)).toBe(true);
    const accepted = await acceptDesign(drafted, changed);
    expect(accepted.design!.acceptedRevision).toBe(job.design!.acceptedRevision + 1);
    expect(modelKey(accepted)).not.toBe(modelKey(job));
    expect(widthOf(accepted.design!.accepted!).expression).toBe('20+30');
    expect(
      boardGeometryKey(
        accepted,
        legacy.parts.map(part => part.id)
      )
    ).toBe(
      boardGeometryKey(
        job,
        legacy.parts.map(part => part.id)
      )
    );
  });
});

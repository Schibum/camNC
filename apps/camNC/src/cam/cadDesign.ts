import { migrateDimensionPlacements, type CadDocument } from '@wbcnc/cad';
import { solveCadDocument } from '../cad/solveCad';
import { updateJobForModel, type CamJobV1 } from './jobDb';
import { carryDesignTabs } from './designTabAnchors';
import { designGeometryFingerprint, designGeometryKey } from './designGeometry';
import { missingNativeHoleChoices } from './holeChoices';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Representation upgrades are not edits; durable optimistic guards still compare exact snapshots below.
const sameDesignContent = (a: CadDocument | null | undefined, b: CadDocument | null | undefined) =>
  same(a && { ...migrateDimensionPlacements(a), revision: 0 }, b && { ...migrateDimensionPlacements(b), revision: 0 });

/** A draft is recoverable after reload; it never changes the geometry CAM has accepted. */
export async function saveDesignDraft(
  base: CamJobV1,
  document: CadDocument,
  expectedDraft: CadDocument | undefined = base.design?.draft
): Promise<CamJobV1> {
  if (!base.design || document.id !== base.design.draft.id) throw new Error('This design is no longer open.');
  const saved = await updateJobForModel(base, current => {
    if (!current.design || !same(current.design.draft, expectedDraft)) return null;
    return { ...current, design: { ...current.design, draft: document } };
  });
  if (!saved) {
    const error = new Error('This design changed in another view. Your local sketch is kept; save a copy or use the saved sketch.');
    error.name = 'CadDraftConflict';
    throw error;
  }
  return saved;
}

/** Accept a valid sketch as a new CAM revision, preserving settings and references by permanent ID. */
export async function acceptDesign(base: CamJobV1, document: CadDocument): Promise<CamJobV1> {
  if (!base.design) throw new Error('This job is not a native design.');
  const solved = await solveCadDocument(document);
  if (solved.status !== 'solved' || !solved.parts.length)
    throw new Error(
      solved.diagnostics.find(d => d.severity === 'error')?.message || 'Draw at least one closed part before continuing to Boards.'
    );
  const before = base.design.accepted ? await solveCadDocument(base.design.accepted) : null;
  const partGeometryKeys = Object.fromEntries(
    await Promise.all(solved.parts.map(async part => [part.partId, await designGeometryKey(part)]))
  );
  const saved = await updateJobForModel(base, current => {
    if (!current.design || !same(current.design.draft, base.design!.draft)) return null;
    const previous = new Map(before?.parts.map(p => [p.partId, p]) ?? []);
    const partRevisions = { ...current.design.partRevisions };
    for (const part of solved.parts) {
      const oldPart = previous.get(part.partId);
      if (!oldPart || designGeometryFingerprint(oldPart) !== designGeometryFingerprint(part))
        partRevisions[part.partId] = (partRevisions[part.partId] ?? 0) + 1;
    }
    const present = new Set(solved.document.parts.map(p => p.id));
    for (const id of previous.keys()) if (!present.has(id)) partRevisions[id] = (partRevisions[id] ?? 0) + 1;
    const known = new Map(current.parts.map(p => [p.id, p]));
    const nativeParts = solved.parts.map(p => ({
      id: p.partId,
      name: p.name,
      quantity: known.get(p.partId)?.quantity ?? 1,
      milled: known.get(p.partId)?.milled ?? true,
    }));
    // Missing part records remain available to repair existing board references.
    const ids = new Set(nativeParts.map(p => p.id));
    const holeChoiceIssues = missingNativeHoleChoices(solved.parts, current.plan?.holes);
    const acceptedGeometry = { ...current, design: { ...current.design, partRevisions, partGeometryKeys } };
    const boardSourceKeys = Object.fromEntries(
      (current.boards ?? []).map(board => [
        board.id,
        boardGeometryKey(
          acceptedGeometry,
          board.items.filter(id => !current.plan?.leaveOut?.includes(id)).map(id => id.split('#')[0]!)
        ),
      ])
    );
    return {
      ...current,
      name: solved.document.name,
      fileName: solved.document.name,
      readError: undefined,
      parts: [...nativeParts, ...current.parts.filter(p => !ids.has(p.id))],
      // CAD origin changes are not layout commands: the saved CAM positions remain authoritative.
      boards: carryDesignTabs(current.boards, before, solved, boardSourceKeys),
      design: {
        draft: solved.document,
        accepted: solved.document,
        acceptedRevision: current.design.acceptedRevision + (sameDesignContent(current.design.accepted, solved.document) ? 0 : 1),
        partRevisions,
        partGeometryKeys,
        ...(holeChoiceIssues.length && { holeChoiceIssues }),
      },
    };
  });
  if (!saved) throw new Error('This design changed while it was being solved. Reopen it before accepting changes.');
  return saved;
}

export const hasDesignDraft = (job: CamJobV1) => !!job.design && !sameDesignContent(job.design.draft, job.design.accepted);

/** Physical stock depends on accepted geometry content, so a true revert can use its original remaining programs. */
export function boardGeometryKey(job: CamJobV1, partIds: string[]) {
  if (!job.design) return undefined;
  return `${job.id}:parts:${JSON.stringify([...new Set(partIds)].sort().map(id => [id, job.design!.partGeometryKeys?.[id] ?? `revision:${job.design!.partRevisions[id] ?? 0}`]))}`;
}

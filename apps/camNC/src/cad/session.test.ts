import { createPlateDocument, updateDimension } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { acquireCadKeyboard, isCadEditorActive } from './keyboardOwnership';
import {
  amendCadSession,
  acknowledgeCadSession,
  acceptCadSession,
  cadCommandCheckpoint,
  cadSession,
  commitCadSession,
  endCadSession,
  redoCadSession,
  undoCadSession,
} from './session';

describe('CAD editing sessions', () => {
  it('keeps source IDs and undo across a route remount, while a new edit clears redo', () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const session = cadSession(document);
    commitCadSession(session, updateDimension(document, width.id, 160));
    expect(cadSession(document)).toBe(session);
    const undone = undoCadSession(session);
    expect(undone.parts[0]!.id).toBe(document.parts[0]!.id);
    expect(undone.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120 });
    expect(redoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 160 });
    undoCadSession(session);
    commitCadSession(session, updateDimension(session.document, width.id, 140));
    expect(session.future).toHaveLength(0);
    expect(session.entry).toEqual(document);
    endCadSession(document.id);
    expect(cadSession(document)).not.toBe(session);
  });

  it('releases keyboard ownership once per mounted owner, including overlapping mounts', () => {
    const releaseA = acquireCadKeyboard(),
      releaseB = acquireCadKeyboard();
    expect(isCadEditorActive()).toBe(true);
    releaseA();
    releaseA();
    expect(isCadEditorActive()).toBe(true);
    releaseB();
    expect(isCadEditorActive()).toBe(false);
  });

  it('amends the current creation value while retaining a single undo and redo command', () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const session = cadSession(document);
    commitCadSession(session, updateDimension(document, width.id, 160));
    const checkpoint = cadCommandCheckpoint(session);
    const amended = amendCadSession(session, updateDimension(session.document, width.id, 180), checkpoint);
    expect(amended?.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 180 });
    expect(session.past).toHaveLength(1);
    expect(undoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120 });
    expect(redoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 180 });
    endCadSession(document.id);
  });

  it('rejects an amendment after an unrelated command even when the undo stack length is unchanged', () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const session = cadSession(document);
    commitCadSession(session, updateDimension(document, width.id, 160));
    const checkpoint = cadCommandCheckpoint(session);
    undoCadSession(session);
    commitCadSession(session, updateDimension(session.document, width.id, 140));
    const current = structuredClone(session.document);
    expect(session.past).toHaveLength(checkpoint.pastLength);
    expect(amendCadSession(session, updateDimension(session.document, width.id, 180), checkpoint)).toBeNull();
    expect(session.document).toEqual(current);
    expect(amendCadSession(session, { ...current, id: 'other-document' }, cadCommandCheckpoint(session))).toBeNull();
    endCadSession(document.id);
  });

  it('retains Undo across Finish and reentry while Cancel starts from the accepted design', () => {
    const document = createPlateDocument(),
      session = cadSession(document);
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    commitCadSession(session, updateDimension(document, width.id, 160));
    const accepted = structuredClone(session.document),
      past = structuredClone(session.past);
    acceptCadSession(session, accepted);
    expect(session.past).toEqual(past);
    expect(session.entry).toEqual(accepted);
    expect(cadSession(accepted)).toBe(session);
    expect(undoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120 });
    expect(session.entry).toEqual(accepted);
    expect(redoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 160 });
    expect(session.entry).toEqual(accepted);
    endCadSession(document.id);
  });

  it('adopts canonical solved coordinates on reentry without changing source IDs or adding an undo step', () => {
    const document = createPlateDocument(),
      session = cadSession(document);
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    commitCadSession(session, updateDimension(document, width.id, 160));
    acceptCadSession(session, session.document);
    const canonical = structuredClone(session.document);
    const corner = canonical.parts[0]!.sketch.entities.find(e => e.type === 'point' && !e.fixed)!;
    if (corner.type !== 'point') throw Error();
    corner.x += 1e-8;
    // The route acknowledges the canonical document returned by durable acceptance.
    acknowledgeCadSession(session, canonical);
    expect(cadSession(canonical).document).toEqual(canonical);
    expect(session.entry).toEqual(canonical);
    expect(session.past).toHaveLength(1);
    expect(undoCadSession(session).parts[0]!.sketch.entities.map(e => e.id)).toEqual(document.parts[0]!.sketch.entities.map(e => e.id));
    const redone = redoCadSession(session);
    expect(redone.parts[0]!.sketch).toEqual(canonical.parts[0]!.sketch);
    endCadSession(document.id);
  });

  it('preserves redo when Finish accepts an undone design and clones the accepted baseline', () => {
    const document = createPlateDocument(),
      session = cadSession(document);
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    commitCadSession(session, updateDimension(document, width.id, 160));
    undoCadSession(session);
    const accepted = structuredClone(session.document);
    acceptCadSession(session, accepted);
    const reopened = cadSession(accepted);
    expect(reopened.future).toHaveLength(1);
    expect(redoCadSession(reopened).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 160 });
    accepted.name = 'Changed outside the history';
    expect(session.entry.name).toBe(document.name);
    expect(session.entry.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120 });
    endCadSession(document.id);
  });

  it('rejects cross-document acceptance atomically', () => {
    const document = createPlateDocument(),
      session = cadSession(document),
      before = structuredClone(session);
    expect(() => acceptCadSession(session, createPlateDocument())).toThrow(/different CAD document/);
    expect(session).toEqual(before);
    endCadSession(document.id);
  });

  it('keeps a newer local edit if an acceptance caller stays mounted before later route reentry', () => {
    const document = createPlateDocument(),
      session = cadSession(document);
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    acceptCadSession(session, session.document);
    commitCadSession(session, updateDimension(session.document, width.id, 160));
    expect(cadSession(document).document.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 160 });
    expect(session.entry).toEqual(document);
    endCadSession(document.id);
  });
});

import { createCadPart, createPlateDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { cadViewState, saveCadViewState } from './viewState';
import { endCadSession } from './session';

const view = { x: 10, y: -50, w: 200, h: 150 };
describe('CAD view context', () => {
  it('keeps view context independently of the editing checkpoint and filters deleted references', () => {
    const document = createPlateDocument();
    const second = createCadPart('Second');
    document.parts.push(second);
    const selectedEntityIds = [second.sketch.entities[0]!.id];
    saveCadViewState(document.id, { selectedPartId: second.id, view, selectedEntityIds });
    endCadSession(document.id);
    expect(cadViewState(document, view)).toEqual({ selectedPartId: second.id, view, selectedEntityIds });
    expect(cadViewState(document, view, document.parts[0]!.id).selectedPartId).toBe(document.parts[0]!.id);
    const removed = { ...document, parts: [document.parts[0]!] };
    expect(cadViewState(removed, view)).toEqual({ selectedPartId: document.parts[0]!.id, view, selectedEntityIds: [] });
  });
});

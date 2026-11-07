import type { CadDocument } from '@wbcnc/cad';

export interface CadViewport {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface CadViewState {
  selectedPartId: string;
  view: CadViewport;
  selectedEntityIds: string[];
}

// View context belongs to a document, independently of the Finish/Cancel undo checkpoint.
const views = new Map<string, CadViewState>();

export function cadViewState(document: CadDocument, fallbackView: CadViewport, preferredPartId?: string): CadViewState {
  const saved = views.get(document.id);
  const part =
    document.parts.find(p => p.id === preferredPartId) ?? document.parts.find(p => p.id === saved?.selectedPartId) ?? document.parts[0];
  return {
    selectedPartId: part?.id ?? '',
    view: { ...(saved?.view ?? fallbackView) },
    selectedEntityIds: saved?.selectedEntityIds.filter(id => part?.sketch.entities.some(entity => entity.id === id)) ?? [],
  };
}

export function saveCadViewState(documentId: string, state: CadViewState) {
  views.set(documentId, { ...state, view: { ...state.view }, selectedEntityIds: [...state.selectedEntityIds] });
}

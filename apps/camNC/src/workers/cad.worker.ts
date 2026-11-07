import {
  prepareDimensionCreation,
  solveCadDocument,
  type CadDimension,
  type CadDocument,
  type CadPart,
  type CadSolveOptions,
  type CadSolveResult,
} from '@wbcnc/cad';
import * as Comlink from 'comlink';

/** Separate from CAM generation: a complex sketch must not block drawing or machine controls. */
const api = {
  solve(document: CadDocument, options?: CadSolveOptions): Promise<CadSolveResult> {
    return solveCadDocument(document, options);
  },
  prepareDimension(part: CadPart, dimension: CadDimension) {
    return prepareDimensionCreation(part, dimension);
  },
};

export type CadWorkerAPI = typeof api;
Comlink.expose(api);

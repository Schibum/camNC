import type { CadDimension, CadDimensionCreationResult, CadDocument, CadPart, CadSolveOptions, CadSolveResult } from '@wbcnc/cad';
import * as Comlink from 'comlink';
import type { CadWorkerAPI } from '../workers/cad.worker';

interface SolverClient {
  worker: Worker;
  remote: Comlink.Remote<CadWorkerAPI>;
  pending: Set<(error: Error) => void>;
}
let client: SolverClient | undefined;

function failClient(target: SolverClient, error: Error) {
  if (client === target) client = undefined;
  for (const reject of target.pending) reject(error);
  target.pending.clear();
  target.remote[Comlink.releaseProxy]();
  target.worker.terminate();
}

function solverClient(): SolverClient {
  if (client) return client;
  const worker = new Worker(new URL('../workers/cad.worker.ts', import.meta.url), { type: 'module', name: 'CAD sketch solver' });
  const target: SolverClient = { worker, remote: Comlink.wrap<CadWorkerAPI>(worker), pending: new Set() };
  worker.addEventListener('error', event =>
    failClient(target, new Error(event.message || 'The sketch solver worker stopped. Try the edit again.'))
  );
  worker.addEventListener('messageerror', () => failClient(target, new Error('The sketch solver returned an unreadable result.')));
  client = target;
  return target;
}

function request<T>(run: (remote: Comlink.Remote<CadWorkerAPI>) => Promise<T>): Promise<T> {
  const target = solverClient();
  return new Promise((resolve, reject) => {
    const cancel = (error: Error) => reject(error);
    target.pending.add(cancel);
    void run(target.remote)
      .then(resolve, reject)
      .finally(() => target.pending.delete(cancel));
  });
}

/** One lazy worker per app session. Callers compare source revisions before applying a result. */
export function solveCadDocument(document: CadDocument, options?: CadSolveOptions): Promise<CadSolveResult> {
  return request(remote => remote.solve(document, options));
}

/** Native constraint-rank analysis for one fresh dimension, detached from document/history mutation. */
export function prepareDimensionCreation(part: CadPart, dimension: CadDimension): Promise<CadDimensionCreationResult> {
  return request<CadDimensionCreationResult>(remote => remote.prepareDimension(part, dimension));
}

/** Releases native WASM state and rejects pending calls instead of leaving abandoned Comlink requests waiting. */
export function disposeCadSolver() {
  if (client) failClient(client, new Error('The sketch solver was closed.'));
}

if (import.meta.hot) import.meta.hot.dispose(disposeCadSolver);

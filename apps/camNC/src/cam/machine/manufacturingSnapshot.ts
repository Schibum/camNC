import type { CamPartInfo } from '../camTypes';
import type { BoardOverlay, QueueEntry } from './camMachine';
import type { PartInstance } from '../boards';

/** A manufacturing setup belongs to the geometry that generated it, even after the design changes. */
export interface ManufacturingSnapshot {
  /** One execution attempt, distinct even when its source and G-code bytes are identical. */
  runId?: string;
  jobId: string;
  sourceKey: string;
  designRevision: number;
  /** A missing durable board is a deletion, rather than an unsaved automatically derived board. */
  boardWasSaved?: boolean;
  active: string;
  doneId: string;
  gcode: string;
  queue: QueueEntry[];
  /** Ready board-program metadata for completed-cut provenance; never used to load another entry. */
  recordQueue?: QueueEntry[];
  parts: CamPartInfo[];
  instances: PartInstance[];
  nestBit: number;
  overlay: BoardOverlay | null;
}

/** Clone at the boundary: live query data and editable board records must never mutate a run. */
export function captureManufacturingSnapshot(input: ManufacturingSnapshot): ManufacturingSnapshot {
  return structuredClone(input);
}

/** Recovery protects this exact executable setup, not another program sharing its design revision. */
export function matchesResumableSetup(
  state: { jobId: string | null; active: string | null; runSnapshot: ManufacturingSnapshot | null },
  interrupted: ManufacturingSnapshot | undefined
): boolean {
  const run = state.runSnapshot;
  return !!(
    run &&
    interrupted &&
    state.jobId === run.jobId &&
    state.active === run.active &&
    run.jobId === interrupted.jobId &&
    run.active === interrupted.active &&
    (!(run.runId !== undefined || interrupted.runId !== undefined) || run.runId === interrupted.runId) &&
    run.sourceKey === interrupted.sourceKey &&
    run.doneId === interrupted.doneId &&
    run.gcode === interrupted.gcode
  );
}

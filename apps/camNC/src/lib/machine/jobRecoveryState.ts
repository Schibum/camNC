import { signal } from '@preact/signals-react';
import type { JobProgressLog, JobRecord } from './jobRecord';

// The signals alone, so the machine state can read them without importing job recovery, which imports the machine state.
export interface InterruptedJob {
  record: JobRecord;
  progress: JobProgressLog;
  reason: string;
}
export const interruptedJob = signal<InterruptedJob | null>(null);
/** Durable setup discovery precedes queue replacement, including while the socket connects. */
export const recoveryPending = signal(false);

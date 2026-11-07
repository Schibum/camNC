import type { JobRecord } from './jobRecord';

export type ExecutionReference = Pick<JobRecord, 'host' | 'startedAt' | 'executionId'>;
/** UI ownership uses the same unique execution identity as durable receipts; old metadata has a time/host fallback. */
export function sameExecutionReference(a: ExecutionReference | null | undefined, b: ExecutionReference | null | undefined): boolean {
  if (!a || !b || a.host !== b.host) return false;
  if (a.executionId || b.executionId) return !!a.executionId && a.executionId === b.executionId;
  return a.startedAt === b.startedAt;
}
export function executionReference(record: JobRecord): ExecutionReference {
  return { host: record.host, startedAt: record.startedAt, executionId: record.executionId };
}

import type { CncApi } from '../fluidnc/cnc-api';
import { getExistingCncApi } from '../fluidnc/machine';
import { isDemoMode } from '../demo/demo-mode';
import { useCamMachine } from '@/cam/machine/camMachine';
import { readJobRecordHead, type JobRecord } from './jobRecord';

const ownFile = /^(?:\/sd\/|\/)?(camnc(?:-resume)?-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.gcode)$/i;
interface Retirement {
  pendingUpload: boolean;
  pendingUntil?: number;
  failures: number;
  retryAt: number;
}
const fallback = new Map<string, Retirement>();
const retryBaseMs = 1000;
const retryMaximumMs = 60_000;
const pendingUploadRetryMs = 30_000;
// A timed-out write can arrive late, but it must not keep polling an SD card forever.
// Expiry relinquishes cleanup ownership; it never authorizes an SD request or deletion.
const pendingUploadRetentionMs = 60 * 60_000;
const prefix = (host: string, demo: boolean) => `camnc-retired-execution:${demo ? 'demo' : 'normal'}:${encodeURIComponent(host)}:`;
const basename = (file: string) => ownFile.exec(file)?.[1];

function withPendingDeadline(state: Retirement): Retirement {
  return state.pendingUpload && state.pendingUntil === undefined
    ? { ...state, pendingUntil: Date.now() + pendingUploadRetentionMs }
    : state;
}

function retirement(key: string): Retirement | null {
  const memory = fallback.get(key);
  if (memory) return memory;
  let state: Retirement = { pendingUpload: true, failures: 0, retryAt: 0 };
  try {
    const value = localStorage.getItem(key);
    if (value === null) return null;
    if (value === '1') return { pendingUpload: false, failures: 0, retryAt: 0 };
    const saved: unknown = JSON.parse(value);
    if (saved && typeof saved === 'object') {
      const parsed = saved as Partial<Retirement>;
      state = {
        pendingUpload: parsed.pendingUpload === true,
        pendingUntil: typeof parsed.pendingUntil === 'number' && Number.isFinite(parsed.pendingUntil) ? parsed.pendingUntil : undefined,
        failures:
          typeof parsed.failures === 'number' && Number.isFinite(parsed.failures)
            ? Math.max(0, Math.min(16, Math.floor(parsed.failures)))
            : 0,
        retryAt: typeof parsed.retryAt === 'number' && Number.isFinite(parsed.retryAt) ? parsed.retryAt : 0,
      };
    }
  } catch {
    /* Keep malformed ownership conservative: absence cannot establish that an upload has finished. */
  }
  const bounded = withPendingDeadline(state);
  // Older undated markers receive one window, persisted now so reloads cannot renew it.
  if (bounded !== state) keep(key, bounded);
  return bounded;
}

function keep(key: string, state: Retirement) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
    fallback.delete(key);
  } catch {
    fallback.set(key, state);
  }
}

function defer(key: string, failure = false) {
  const state = retirement(key);
  if (!state) return;
  const failures = failure ? Math.min(16, state.failures + 1) : state.failures;
  const delay = failure ? Math.min(retryMaximumMs, retryBaseMs * 2 ** (failures - 1)) : pendingUploadRetryMs;
  keep(key, { ...state, failures, retryAt: Date.now() + delay });
}

/** Only files from a dispatch we know was superseded or never requested become eligible. No directory sweeping. */
export function retireExecutionFiles(
  host: string,
  names: readonly string[],
  demo = isDemoMode(),
  { pendingUpload = false }: { pendingUpload?: boolean } = {}
) {
  for (const name of names) {
    const file = basename(name);
    if (!file) continue; // Legacy shared names and user files cannot establish exclusive ownership.
    const key = prefix(host, demo) + file;
    const previous = retirement(key);
    keep(key, withPendingDeadline({ failures: 0, retryAt: 0, ...previous, pendingUpload: pendingUpload || !!previous?.pendingUpload }));
  }
}

function retired(host: string, demo: boolean) {
  const start = prefix(host, demo),
    keys = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(start)) keys.add(key);
    }
  } catch {
    /* Keep in-memory retirements if browser storage is unavailable. */
  }
  for (const key of fallback.keys()) if (key.startsWith(start)) keys.add(key);
  return [...keys]
    .map(key => ({ key, file: basename(key.slice(start.length)), state: retirement(key) }))
    .filter(item => !!item.file && !!item.state);
}

function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    return false;
  }
  fallback.delete(key);
  return true;
}

function expirePending(key: string, state: Retirement) {
  if (!state.pendingUpload || state.pendingUntil === undefined || state.pendingUntil > Date.now()) return false;
  // Even if browser storage is temporarily unwritable, an expired marker cannot issue controller requests.
  forget(key);
  return true;
}

function protectedFiles(records: (JobRecord | null)[]) {
  const files = new Set<string>();
  const seen = new Set<JobRecord>();
  for (let record of records) {
    while (record && !seen.has(record)) {
      seen.add(record);
      const file = basename(record.sdFile);
      if (file) files.add(file.toLowerCase());
      record = record.previousRecord ?? null;
    }
  }
  return files;
}

export interface ExecutionFileCleanupOptions {
  demo?: boolean;
  /** Additional caller ownership guard, checked again after every storage/controller await. */
  isCurrent?: () => boolean;
}
export interface ExecutionFileCleanupResult {
  removed: string[];
  pending: number;
}
const cleaning = new Map<string, Promise<ExecutionFileCleanupResult>>();

/** Delete known retired objects only while idle, retaining the current raw and eligible recovery files. */
export function cleanupRetiredExecutionFiles(api: CncApi, options: ExecutionFileCleanupOptions = {}): Promise<ExecutionFileCleanupResult> {
  const host = api.host.value,
    demo = options.demo ?? isDemoMode();
  if (!host) return Promise.resolve({ removed: [], pending: 0 });
  const key = prefix(host, demo),
    current = cleaning.get(key);
  if (current) return current;
  const idle = () =>
    getExistingCncApi() === api &&
    api.host.value === host &&
    isDemoMode() === demo &&
    (options.isCurrent?.() ?? true) &&
    !useCamMachine.getState().preparingRun &&
    api.isConnected?.value === true &&
    api.status.value?.state === 'Idle' &&
    !api.status.value.job &&
    api.jobProgress?.value == null &&
    api.jobStartedAt?.value == null;
  const operation = (async () => {
    const removed: string[] = [];
    const entries = retired(host, demo).filter(item => !expirePending(item.key, item.state!));
    if (typeof api.deleteFile !== 'function') return { removed, pending: retired(host, demo).length };
    let listed: Set<string> | undefined;
    for (const item of entries) {
      if (expirePending(item.key, item.state!)) continue;
      if (item.state!.retryAt > Date.now()) continue;
      if (!idle()) break;
      try {
        const head = await readJobRecordHead(host, demo);
        if (!idle()) break;
        if (expirePending(item.key, item.state!)) continue;
        if (protectedFiles([head.stored, head.record]).has(item.file!.toLowerCase())) continue;
        if (item.state!.pendingUpload) {
          if (typeof api.listFiles !== 'function') throw new Error('Cannot inspect the pending execution upload yet.');
          if (!listed) {
            const listing = await api.listFiles();
            listed = new Set(listing.files.flatMap(file => basename(file.name)?.toLowerCase() ?? []));
          }
          if (!idle()) break;
          if (expirePending(item.key, item.state!)) continue;
          if (!listed.has(item.file!.toLowerCase())) {
            // A timed-out upload may still land on SD. Missing now does not release this UUID's retirement.
            defer(item.key);
            continue;
          }
          // Listing is another controller await: protect any receipt that became current while it was in flight.
          const latest = await readJobRecordHead(host, demo);
          if (!idle()) break;
          if (expirePending(item.key, item.state!)) continue;
          if (protectedFiles([latest.stored, latest.record]).has(item.file!.toLowerCase())) continue;
        }
        try {
          await api.deleteFile(item.file!);
        } catch (error) {
          // A prior delete may have succeeded before its acknowledgement was lost. Check rather than retry blindly.
          if (!idle() || typeof api.listFiles !== 'function') throw error;
          if (expirePending(item.key, item.state!)) continue;
          const listing = await api.listFiles();
          if (!idle() || listing.files.some(file => basename(file.name)?.toLowerCase() === item.file!.toLowerCase())) throw error;
        }
        if (!forget(item.key)) defer(item.key);
        listed?.delete(item.file!.toLowerCase());
        removed.push(item.file!);
      } catch (error) {
        defer(item.key, true);
        throw error;
      }
    }
    return { removed, pending: retired(host, demo).length };
  })();
  cleaning.set(key, operation);
  void operation
    .finally(() => {
      if (cleaning.get(key) === operation) cleaning.delete(key);
    })
    .catch(() => {});
  return operation;
}

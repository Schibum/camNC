import { spacingProblem } from './boards';
import type { PlanResult } from './camTypes';
import type { JobBoard, MissingPart } from './useJobBoards';

/** Why a board can't be cut: the Plan step's buttons and the machine queue ask the same functions. */
export interface BlockContext {
  /** The job's main bit. */
  bit: number;
  /** Parts that don't fit their board and aren't left out on purpose, of all boards. */
  missing: MissingPart[];
}

/** Broken safety rules of the guided programs after the board's cutting. */
export const releaseProblems = (plan: PlanResult | undefined) => plan?.release?.flatMap(r => r.safety) ?? [];

/** Parts that would come loose: their tabs don't hold, and they have no fallback (tabs anyway, or held by hand). */
export function loose(plan: PlanResult | undefined) {
  if (!plan?.hold) return [];
  return plan.hold.filter(h => !h.ok && (plan.holding?.find(x => x.name === h.part)?.how ?? 'placed') === 'placed');
}

/** Stock that would turn or lift during the job, a part that comes loose, or a screw or clamp in the bit's way. */
export function unstable(plan: PlanResult | undefined) {
  return !!plan && ((plan.timeline ?? []).some(e => e.block) || (plan.holdClash ?? []).length > 0);
}

/** What's wrong with the board's layout, whatever its programs are. */
export function layoutBlock(b: Pick<JobBoard, 'board' | 'nest'>, { bit, missing }: BlockContext): string | null {
  const own = missing.filter(m => m.board === b.board.name);
  if (own.length)
    return `${own.map(m => m.name).join(', ')} ${own.length === 1 ? 'doesn’t' : 'don’t'} fit on board ${b.board.name} and would not be cut.`;
  return spacingProblem(b.board, b.nest, bit);
}

/** What's wrong with the board's programs: side A, side B and the guided ones after them. */
export function planBlock(plan: PlanResult): string | null {
  if (!plan.ops.length) return 'Nothing to cut: its parts have no outline, hole or pocket this bit can cut.';
  const broken = [...plan.safety, ...(plan.sideB?.safety ?? []).map(s => `Side B: ${s}`), ...releaseProblems(plan)];
  if (broken.length) return `A safety check failed: ${broken[0]}${broken.length > 1 ? ` (and ${broken.length - 1} more)` : ''}`;
  if (plan.flip?.problem) return plan.flip.problem;
  const looseParts = loose(plan);
  if (looseParts.length) return `${looseParts.map(h => h.part).join(', ')} would come loose: too few of the tabs hold.`;
  const pivot = plan.timeline?.find(e => e.block);
  if (pivot) return pivot.message;
  const clashes = plan.holdClash?.length ?? 0;
  if (clashes) return `${clashes === 1 ? 'A screw or clamp is' : `${clashes} screws or clamps are`} in the bit’s way.`;
  return null;
}

/** Why the board can't be cut, or null. `plan`: its programs, when it has any. */
export function boardBlock(b: Pick<JobBoard, 'board' | 'nest'>, plan: PlanResult | undefined, context: BlockContext): string | null {
  return layoutBlock(b, context) ?? (plan ? planBlock(plan) : null);
}

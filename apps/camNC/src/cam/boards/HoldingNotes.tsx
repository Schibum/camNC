import type { TabFallback } from '@wbcnc/cam';
import { Button } from '@wbcnc/ui/components/button';
import type { BoardV1 } from '../boards';
import type { PlanResult } from '../camTypes';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/** What fixes a part whose tabs can't hold: one click each, nothing switched without asking. */
const kFixes: [TabFallback, string][] = [
  ['skin', 'Bottom skin'],
  ['tabs', 'Tabs anyway'],
  ['self', 'I hold it down'],
];

const kFallbackNote: Record<TabFallback, string> = {
  skin: 'keeps a bottom skin, freed at the machine',
  tabs: 'gets tabs anyway (they may not hold)',
  self: 'gets no tabs: hold it down yourself',
};

const names = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);

/**
 * Where tabs fell short on a board, grouped so each reason is said once: the parts with no two opposite edges to hold
 * them (which block the job until one choice fixes them all), the parts that get the fallback chosen for them, and
 * the parts where fewer tabs fit than asked. A single part can still be set apart from its chip's menu.
 */
export function HoldingNotes({
  holding,
  board,
  itemOf,
  onFallback,
  onFrame,
  noFrame,
}: {
  holding: PlanResult['holding'];
  board: BoardV1;
  /** The board item of a part name, for its own fallback. */
  itemOf: (name: string) => string | undefined;
  /** One fallback for all of these items, in one change. */
  onFallback: (itemIds: string[], f: TabFallback) => void;
  /** Turns the frame on, when it's off: the usual reason tabs have nothing to hold on to. */
  onFrame?: () => void;
  /** The frame was left out: the parts don't fit this board with it. Its width, and whether room for the nut is in it. */
  noFrame?: { width: number; nut: boolean };
}) {
  const all = holding ?? [];
  const unheld = all.filter(h => h.how === 'unheld').map(h => h.name);
  const ids = unheld.map(itemOf).filter((id): id is string => !!id);
  const short = all.filter(h => h.how === 'placed' && h.wanted);
  const chosen = (Object.keys(kFallbackNote) as TabFallback[])
    .map(f => [f, all.filter(h => h.how === f).map(h => h.name)] as const)
    .filter(([, list]) => list.length);
  if (!unheld.length && !short.length && !chosen.length) return null;
  const one = unheld.length === 1;
  return (
    <ul aria-label={`Tabs on board ${board.name}`} className="flex flex-col gap-1 text-xs">
      {unheld.length > 0 && (
        <li className="flex flex-col gap-1 text-destructive" onClick={e => e.stopPropagation()}>
          {noFrame && (
            <span>
              {`The frame for the holds (${fmt(noFrame.width)} mm${noFrame.nut ? ', with room for the collet nut' : ''}) doesn't fit on this board with all the parts, so it was left out. Without it, the board's edge is too close for tabs. A larger board, fewer parts on it${noFrame.nut ? ', or a stick-out long enough for the nut to clear the holds (see the drawing)' : ''} brings it back.`}
            </span>
          )}
          <span>
            {`${names(unheld)} ${one ? 'has' : 'have'} no two opposite edges where tabs would hold ${one ? 'it' : 'them'}, so ${
              one ? 'it' : 'they'
            } would come loose. The job waits until you choose${one ? '' : ' (for all of them; set one apart from its chip)'}:`}
          </span>
          <span className="flex flex-wrap gap-1">
            {onFrame && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onFrame}>
                Keep a frame
              </Button>
            )}
            {ids.length > 0 &&
              kFixes.map(([f, label]) => (
                <Button key={f} size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => onFallback(ids, f)}>
                  {label}
                </Button>
              ))}
          </span>
        </li>
      )}
      {chosen.map(([f, list]) => (
        <li key={f} className="text-amber-700 dark:text-amber-400">
          {`${names(list)}: no two opposite edges where tabs hold, so ${list.length > 1 ? 'each' : 'it'} ${kFallbackNote[f]}, as you chose.`}
        </li>
      ))}
      {short.map(h => (
        <li key={h.name} className="text-amber-700 dark:text-amber-400">
          {`${h.name}: ${h.tabs} of ${h.wanted} tabs fit (short edges or little stock that holds around it).`}
        </li>
      ))}
    </ul>
  );
}

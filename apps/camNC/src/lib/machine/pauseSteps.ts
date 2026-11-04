import type { PauseMarker } from '@wbcnc/cam/pauseMarker';

export interface Step {
  title: string;
  detail?: string;
  /** The part to hold down next: marked green, like its ring in the camera view. */
  hold?: boolean;
}

const kRouterOn = 'Router on, then Resume';
const kRouterOnDetail = 'If you switch the router by hand, turn it back on first. Otherwise Resume starts the spindle.';

/** What to do at one of our own pauses, in order, from its marker. */
export function pauseSteps(m: PauseMarker): { title: string; steps: Step[] } {
  switch (m.kind) {
    case 'start':
      return {
        title: 'Ready to start',
        steps: [
          { title: 'Dust collection on, hands clear of the bit' },
          { title: kRouterOn, detail: `Resume starts the spindle at ${m.rpm} RPM, then the cut.` },
        ],
      };
    case 'take-out':
      return {
        title: `Take out ${m.part}`,
        steps: [
          { title: `Take out ${m.part}`, detail: 'The bit is up and the spindle is stopped.' },
          ...(m.next
            ? [
                { title: `Hold down ${m.next}`, detail: 'It’s cut loose right after Resume. Ringed green in the camera view.', hold: true },
                { title: kRouterOn, detail: kRouterOnDetail },
              ]
            : [{ title: 'Resume', detail: 'That was the last part: the machine parks. A router you switch by hand stays off.' }]),
        ],
      };
    case 'tab':
      return {
        title: `Tab ${m.n} of ${m.of}`,
        steps: [
          { title: `Hold ${m.part} at the green ring`, detail: 'Away from the bit. Resume cuts through this tab.', hold: true },
          { title: kRouterOn, detail: kRouterOnDetail },
        ],
      };
    case 'done':
      return {
        title: 'Program done',
        steps: [{ title: 'Switch off a router you switch by hand' }, { title: 'Resume', detail: 'Ends the program.' }],
      };
  }
}

import { describeAlarm, parseSoftLimitMessage, type Position } from '@wbcnc/fluidnc';

/** An alarm as camNC saw it: the code plus everything that helps to resolve it. */
export interface AlarmRecord {
  code: number;
  /** When camNC received `ALARM:N` (ms since epoch). */
  at: number;
  /** Controller `[MSG:…]` texts from shortly before and after the alarm, oldest first. */
  messages: string[];
  /** Machine position at the alarm. */
  mpos: Position | null;
  /** SD job running at the alarm. */
  job: { file: string; percent: number } | null;
  /** The controller has left the alarm state since. A later alarm camNC did not see must not show this one. */
  cleared?: boolean;
}

/** Travel per axis in machine coordinates, as far as known. */
export type TravelBounds = Partial<Record<'X' | 'Y' | 'Z', { min: number; max: number }>>;

export interface AlarmHelp {
  title: string;
  /** What happened, as concretely as the controller told us. */
  cause: string;
  /** What to do about it. */
  fix: string;
}

const fmt = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');

/**
 * Turn an alarm into a concrete explanation and fix. `travel` fills in the soft limits where the controller does not
 * report them (3.9.x).
 */
export function explainAlarm(alarm: AlarmRecord, travel: TravelBounds = {}): AlarmHelp {
  const title = `ALARM:${alarm.code} ${describeAlarm(alarm.code).replace(/\.$/, '')}`;
  const where = alarm.job ? ` in ${alarm.job.file.split('/').pop()} at ${alarm.job.percent.toFixed(1)} %` : '';
  switch (alarm.code) {
    case 1:
      return {
        title,
        cause: `A limit switch triggered while moving${where}${limitSwitchHint(alarm.messages)}. The position is no longer trusted.`,
        fix: 'Check what hit the switch (wrong zero, job too large, or a noisy switch wire), then Unlock and home again before continuing.',
      };
    case 2: {
      const violation = alarm.messages.map(parseSoftLimitMessage).find(v => v !== null);
      if (!violation) {
        return {
          title,
          cause: `A move${where} would leave the machine's travel.`,
          fix: 'Move the work zero further into the travel or make the job smaller, then Unlock (the position is still correct).',
        };
      }
      const limits = violation.min !== undefined && violation.max !== undefined ? violation : travel[violation.axis as 'X' | 'Y' | 'Z'];
      const range = limits ? `, outside the ${violation.axis} travel ${fmt(limits.min!)} to ${fmt(limits.max!)}` : '';
      const over = limits ? (violation.target < limits.min! ? limits.min! - violation.target : violation.target - limits.max!) : null;
      const side = limits ? (violation.target < limits.min! ? 'minimum' : 'maximum') : 'edge';
      return {
        title,
        cause: `The job${where} moved ${violation.axis} to ${fmt(violation.target)} (machine coordinates)${range}. The toolpath reaches past the ${violation.axis} ${side}, or the work zero is too close to it.`,
        fix:
          over !== null && over > 0
            ? `Move the ${violation.axis} zero at least ${fmt(Math.ceil(over * 100) / 100 + 0.01)} mm away from the ${side}, or shrink the job. Then Unlock: the position is still correct.`
            : `Move the ${violation.axis} zero further into the travel or shrink the job. Then Unlock: the position is still correct.`,
      };
    }
    case 3:
      return {
        title,
        cause: `The controller was reset while moving${where}. Steps may have been lost, so the position is no longer trusted.`,
        fix: 'Home again (or re-zero all axes) before continuing. Resetting during a job always does this; use Pause to stop safely.',
      };
    case 4:
      return {
        title,
        cause: 'The probe input was already active when probing started.',
        fix: 'Check the probe clip is not touching the plate (or the wire is not shorted), then Unlock and probe again.',
      };
    case 5:
      return {
        title,
        cause: 'The probe did not touch the plate within the probe travel.',
        fix: 'Lower Z closer to the plate or increase the probe travel, check the clip is on the bit and the plate is under it, then Unlock and probe again.',
      };
    case 6:
    case 7:
    case 8:
    case 9:
      return {
        title,
        cause: homingCause(alarm.code, alarm.messages),
        fix:
          alarm.code === 8
            ? 'The axis did not move off its switch after pull-off: increase the pull-off distance in the config, or check the switch is not stuck. Then home again.'
            : alarm.code === 9
              ? 'The switch was not found within the search distance: check the switch and its wiring, that the axis can move freely, and the homing direction. Then home again.'
              : 'Home again once the cause is cleared.',
      };
    case 11:
      return {
        title,
        cause: 'A limit or control input was active when the controller started.',
        fix: 'Move the axis off its switch by hand (or check for a shorted input), then Unlock or reset.',
      };
    case 14:
      return {
        title,
        cause: 'The controller requires homing after start or reset.',
        fix: 'Home all axes. Unlock only if you are sure the position is still correct.',
      };
    default:
      return {
        title,
        cause: `The controller stopped${where}.`,
        fix: 'Check the console for the controller messages around the alarm, then Unlock or home.',
      };
  }
}

function limitSwitchHint(messages: string[]) {
  const hit = messages.map(m => m.match(/Limit switch tripped for ([A-Z])|limit.*?\b([XYZ])\b/i)).find(m => m);
  const axis = hit?.[1] ?? hit?.[2];
  return axis ? ` (${axis.toUpperCase()} axis)` : '';
}

function homingCause(code: number, messages: string[]) {
  const axis = messages.map(m => m.match(/Homing.*?\b([XYZ])\b/i)?.[1]).find(Boolean);
  const which = axis ? ` on ${axis.toUpperCase()}` : '';
  switch (code) {
    case 6:
      return `Homing${which} was interrupted by a reset.`;
    case 7:
      return `Homing${which} was interrupted by the safety door.`;
    case 8:
      return `Homing${which} could not pull off the limit switch.`;
    default:
      return `Homing${which} did not find the limit switch.`;
  }
}

/** When nothing is known about the alarm (it happened before this page or connection). */
export const kUnknownAlarmHelp: Omit<AlarmHelp, 'title'> = {
  cause: 'camNC did not see this alarm happen: it was raised before this page connected, or while the connection was down.',
  fix: 'If the controller just started or was reset, home it (Home all), or Unlock if you are sure the position is still correct. If it stopped during a job, the console may show why.',
};

const kStorageKey = 'camnc-last-alarm';

/** The last alarm per controller, kept for this browser tab so that it survives a reload or reconnect. */
export function saveLastAlarm(host: string, alarm: AlarmRecord) {
  try {
    sessionStorage.setItem(`${kStorageKey}:${host}`, JSON.stringify(alarm));
  } catch {
    // Storage full or unavailable: only this session loses it.
  }
}

export function loadLastAlarm(host: string): AlarmRecord | null {
  try {
    const raw = sessionStorage.getItem(`${kStorageKey}:${host}`);
    return raw ? (JSON.parse(raw) as AlarmRecord) : null;
  } catch {
    return null;
  }
}

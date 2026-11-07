import { getCncApi } from '@/lib/fluidnc/machine';
import {
  kStandardScreenAxes,
  kTopViewCameraRotation,
  axisStepLabel,
  screenAxesForCamera,
  screenToMachine,
  ScreenAxes,
} from '@/scene/topViewOrientation';
import { useMachineBoundsOrNull, useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { Popover, PopoverAnchor, PopoverContent } from '@wbcnc/ui/components/popover';
import { Slider } from '@wbcnc/ui/components/slider';
import { toast } from '@wbcnc/ui/components/sonner';
import { cn } from '@wbcnc/ui/lib/utils';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Keyboard,
  Square,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isCadEditorActive } from '@/cad/keyboardOwnership';

function report(promise: Promise<unknown>, what: string) {
  return promise.catch(err => {
    toast.error(`${what} failed`, { description: err instanceof Error ? err.message : String(err) });
  });
}

function fmt(n: number | undefined) {
  return n === undefined ? '—' : n.toFixed(2);
}

/** Work position on one line; machine position, feed and pins on hover. */
export function PositionLine({ showFeed = false }: { showFeed?: boolean }) {
  'use no memo';
  const api = getCncApi();
  const status = api.status.value;
  const wcs = api.currentOffsetModal.value ?? 'G54';
  const machine = status ? `Machine X ${fmt(status.mpos.x)} Y ${fmt(status.mpos.y)} Z ${fmt(status.mpos.z)}` : '';
  return (
    <div
      className="flex flex-row flex-wrap gap-x-3 text-xs font-mono tabular-nums text-muted-foreground"
      title={machine}
      data-testid="machine-dro">
      <span>{wcs}</span>
      {(['x', 'y', 'z'] as const).map(axis => (
        <span key={axis}>
          <span className="uppercase">{axis}</span> <span className="text-foreground">{fmt(status?.wpos[axis])}</span>
        </span>
      ))}
      {showFeed && <span>F {status?.feed ?? 0}</span>}
      {status?.pins && <span>Pn {status.pins}</span>}
    </div>
  );
}

const kStepsXY = [0.1, 1, 10, 50, 100];
const kStepsZ = [0.05, 0.1, 1, 5, 10];
/** One small, exact step with Shift held: the smallest of the lists above. */
const kMicroStepXY = 0.1;
const kMicroStepZ = 0.05;
/** How long (ms) to hold a jog button for the other step sizes. */
const kLongPressMs = 450;

function StepPicker({ steps, value, onChange, label }: { steps: number[]; value: number; onChange: (v: number) => void; label: string }) {
  return (
    <Label className="flex flex-row items-center gap-1 text-xs font-normal">
      <span className="w-4 text-muted-foreground">{label}</span>
      <select
        aria-label={`${label} jog step`}
        className="h-7 flex-1 rounded-md border bg-transparent px-1 text-xs"
        value={value}
        onChange={e => onChange(Number(e.target.value))}>
        {steps.map(step => (
          <option key={step} value={step}>
            {step} mm
          </option>
        ))}
      </select>
    </Label>
  );
}

/**
 * Machine axes pointing right / up on screen in Top View, with the camera image or the drawn bed alike, or the
 * standard layout while there is no top view (no machine bounds yet).
 */
const kTopViewScreenAxes = screenAxesForCamera(kTopViewCameraRotation);

function useScreenAxes(): ScreenAxes {
  const hasTopView = !!useMachineBoundsOrNull();
  return hasTopView ? kTopViewScreenAxes : kStandardScreenAxes;
}

/**
 * Arrow keys jog X/Y in screen directions, PageUp/PageDown jog Z. Holding a key jogs continuously; releasing it cancels
 * the jog. With Shift, a press is one micro step, and holding it doesn't repeat: repeats would queue up and keep moving.
 */
function useKeyboardJog(enabled: boolean, axes: ScreenAxes) {
  'use no memo';
  useEffect(() => {
    if (!enabled) return;
    const api = getCncApi();
    const keys: Record<string, { x?: number; y?: number; z?: number }> = {
      ArrowLeft: screenToMachine(axes, -1, 0),
      ArrowRight: screenToMachine(axes, 1, 0),
      ArrowUp: screenToMachine(axes, 0, 1),
      ArrowDown: screenToMachine(axes, 0, -1),
      PageUp: { z: 1 },
      PageDown: { z: -1 },
    };
    let active: string | null = null;
    const isTyping = (e: KeyboardEvent) =>
      e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
    const onDown = (e: KeyboardEvent) => {
      const dir = keys[e.key];
      if (!dir || isTyping(e) || isCadEditorActive()) return;
      e.preventDefault();
      if (e.repeat || active || !api.canJog.value) return;
      const prefs = useStore.getState().machinePrefs;
      const feed = dir.z ? prefs.jogFeedZ : prefs.jogFeedXY;
      if (e.shiftKey) {
        const micro = dir.z ? kMicroStepZ : kMicroStepXY;
        void report(api.jogRelative({ x: dir.x && dir.x * micro, y: dir.y && dir.y * micro, z: dir.z && dir.z * micro }, feed), 'Jog');
        return;
      }
      active = e.key;
      // Continuous jog: a long move that is cancelled on key-up (FluidNC limits it to the configured travel).
      const distance = dir.z ? 300 : 3000;
      void api
        .jogRelative({ x: dir.x && dir.x * distance, y: dir.y && dir.y * distance, z: dir.z && dir.z * distance }, feed)
        .catch(() => {});
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== active) return;
      active = null;
      if (api.isConnected.value) api.jogCancel();
    };
    const onBlur = () => {
      if (active && api.isConnected.value) api.jogCancel();
      active = null;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      onBlur();
    };
  }, [enabled, axes]);
}

/**
 * A jog button. A click moves the usual step, with Shift one micro step. Held down (or right-clicked), it offers the other
 * sizes for one move. Nothing moves on letting go of a long press: only a click on a size does.
 */
function JogButton({
  name,
  steps,
  step,
  micro,
  onMove,
  onSetStep,
  disabled,
  className,
  children,
  ...button
}: {
  /** The direction, as in "Move X+ by". */
  name: string;
  steps: number[];
  step: number;
  micro: number;
  onMove: (distance: number) => void;
  onSetStep: (step: number) => void;
} & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const longPressed = useRef(false);
  const offer = () => {
    setKeep(false);
    setOpen(true);
  };
  const release = () => clearTimeout(timer.current);
  useEffect(() => release, []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          {...button}
          variant="outline"
          disabled={disabled}
          className={cn('touch-manipulation select-none', className)}
          onPointerDown={e => {
            if (e.button !== 0) return;
            longPressed.current = false;
            timer.current = setTimeout(() => {
              longPressed.current = true;
              offer();
            }, kLongPressMs);
          }}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
          onContextMenu={e => {
            e.preventDefault();
            release();
            if (!disabled) offer();
          }}
          onClick={e => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            onMove(e.shiftKey ? micro : step);
          }}>
          {children}
        </Button>
      </PopoverAnchor>
      <PopoverContent side="top" className="flex w-auto flex-col gap-2 p-2">
        <p className="text-xs font-medium">Move {name} by</p>
        <div className="flex flex-row gap-1">
          {steps.map(size => (
            <Button
              key={size}
              size="sm"
              variant={size === step ? 'secondary' : 'outline'}
              className="px-2 text-xs"
              onClick={() => {
                onMove(size);
                if (keep) onSetStep(size);
                setOpen(false);
              }}>
              {size} mm
            </Button>
          ))}
        </div>
        <div className="flex flex-row items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={keep} onCheckedChange={v => setKeep(v === true)} /> Use as the usual step
          </label>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function JogPanel() {
  'use no memo';
  const api = getCncApi();
  const prefs = useStore(s => s.machinePrefs);
  const setPrefs = useStore(s => s.setMachinePrefs);
  const canJog = api.canJog.value;
  const axes = useScreenAxes();
  useKeyboardJog(prefs.keyboardJog && canJog, axes);
  // This panel stays in view, so the keys must never move the machine because of a choice made earlier.
  useEffect(() => {
    setPrefs({ keyboardJog: false });
    return () => setPrefs({ keyboardJog: false });
  }, [setPrefs]);

  const jogXY = (dx: number, dy: number, distance: number) =>
    void report(api.jogRelative({ x: dx * distance, y: dy * distance }, prefs.jogFeedXY), 'Jog');
  const jogZ = (dz: number, distance: number) => void report(api.jogRelative({ z: dz * distance }, prefs.jogFeedZ), 'Jog');
  const setStepXY = (jogStepXY: number) => setPrefs({ jogStepXY });
  const setStepZ = (jogStepZ: number) => setPrefs({ jogStepZ });
  // Screen directions (right, up), laid out as on screen and mapped to machine axes as Top View shows them.
  const arrows: [number, number, React.ReactNode][] = [
    [-1, 1, <ArrowUpLeft key="ul" />],
    [0, 1, <ArrowUp key="u" />],
    [1, 1, <ArrowUpRight key="ur" />],
    [-1, 0, <ArrowLeft key="l" />],
    [0, 0, <Square key="stop" />],
    [1, 0, <ArrowRight key="r" />],
    [-1, -1, <ArrowDownLeft key="dl" />],
    [0, -1, <ArrowDown key="d" />],
    [1, -1, <ArrowDownRight key="dr" />],
  ];

  return (
    <div className="flex flex-row items-start gap-4">
      <div className={cn('grid grid-cols-3 gap-1', !canJog && 'opacity-50')}>
        {arrows.map(([sx, sy, icon], i) => {
          if (sx === 0 && sy === 0) {
            return (
              <Button
                key={i}
                size="icon"
                variant="outline"
                className="size-9 [&_svg]:size-3.5"
                title="Cancel jog"
                disabled={!api.isConnected.value}
                onClick={() => api.jogCancel()}>
                {icon}
              </Button>
            );
          }
          const step = screenToMachine(axes, sx, sy);
          const label = axisStepLabel(step);
          return (
            <JogButton
              key={i}
              size="icon"
              className="size-9 flex-col gap-0 [&_svg]:size-3.5"
              disabled={!canJog}
              name={label}
              steps={kStepsXY}
              step={prefs.jogStepXY}
              micro={kMicroStepXY}
              onMove={distance => jogXY(step.x, step.y, distance)}
              onSetStep={setStepXY}
              title={`Jog ${label}. Hold for other sizes, Shift for a micro step.`}
              aria-label={`Jog ${label}`}>
              {icon}
              {/* Axis buttons only; diagonals keep their label in the tooltip. */}
              {(sx === 0 || sy === 0) && <span className="text-[10px] leading-none font-mono">{label}</span>}
            </JogButton>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-row gap-1">
          <JogButton
            size="sm"
            className="flex-1"
            disabled={!canJog}
            name="Z+"
            steps={kStepsZ}
            step={prefs.jogStepZ}
            micro={kMicroStepZ}
            onMove={distance => jogZ(1, distance)}
            onSetStep={setStepZ}
            title="Jog Z+. Hold for other sizes, Shift for a micro step.">
            Z+ <ArrowUp />
          </JogButton>
          <JogButton
            size="sm"
            className="flex-1"
            disabled={!canJog}
            name="Z−"
            steps={kStepsZ}
            step={prefs.jogStepZ}
            micro={kMicroStepZ}
            onMove={distance => jogZ(-1, distance)}
            onSetStep={setStepZ}
            title="Jog Z−. Hold for other sizes, Shift for a micro step.">
            Z− <ArrowDown />
          </JogButton>
        </div>
        <StepPicker label="XY" steps={kStepsXY} value={prefs.jogStepXY} onChange={v => setPrefs({ jogStepXY: v })} />
        <StepPicker label="Z" steps={kStepsZ} value={prefs.jogStepZ} onChange={v => setPrefs({ jogStepZ: v })} />
        <KeyboardJogToggle />
      </div>
    </div>
  );
}

/** Off whenever the jog panel appears, and says so: with it on, the arrow keys move the machine. */
function KeyboardJogToggle() {
  const on = useStore(s => s.machinePrefs.keyboardJog);
  const setPrefs = useStore(s => s.setMachinePrefs);
  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn('h-6 self-end px-1.5 text-xs font-normal text-muted-foreground', on && 'text-amber-700 dark:text-amber-400')}
      aria-pressed={on}
      title="Arrow keys jog X and Y as in Top View, PgUp/PgDn jog Z. Hold to move, or hold Shift for one micro step per press."
      onClick={() => setPrefs({ keyboardJog: !on })}>
      <Keyboard /> {on ? 'Keyboard on' : 'Keyboard off'}
    </Button>
  );
}

export function JogFeeds() {
  const prefs = useStore(s => s.machinePrefs);
  const setPrefs = useStore(s => s.setMachinePrefs);
  return (
    <div className="flex flex-row gap-3 items-center text-xs">
      <Label className="text-xs">
        XY feed
        <Input
          type="number"
          className="h-7 w-20"
          value={prefs.jogFeedXY}
          onChange={e => setPrefs({ jogFeedXY: Number(e.target.value) || prefs.jogFeedXY })}
        />
      </Label>
      <Label className="text-xs">
        Z feed
        <Input
          type="number"
          className="h-7 w-20"
          value={prefs.jogFeedZ}
          onChange={e => setPrefs({ jogFeedZ: Number(e.target.value) || prefs.jogFeedZ })}
        />
      </Label>
    </div>
  );
}

/** Who switches the spindle: CAM programs pause for a router switched by hand, or let M3/M5 do it. */
export function SpindleSetting() {
  const spindle = useStore(s => s.machinePrefs.spindleSwitch ?? 'hand');
  const setPrefs = useStore(s => s.setMachinePrefs);
  return (
    <Label className="text-sm flex flex-row gap-2 items-center">
      Spindle switched
      <select
        className="rounded-md border bg-transparent px-1.5 py-0.5"
        value={spindle}
        onChange={e => setPrefs({ spindleSwitch: e.target.value as 'hand' | 'controller' })}>
        <option value="hand">by hand (a router)</option>
        <option value="controller">by the controller (M3/M5)</option>
      </select>
    </Label>
  );
}

/** Touch plate thickness, how far to probe down and how fast. */
export function ProbeSettings() {
  const prefs = useStore(s => s.machinePrefs);
  const setPrefs = useStore(s => s.setMachinePrefs);
  const field = (label: string, key: 'probePlateThickness' | 'probeMaxTravel' | 'probeFeed') => (
    <Label className="text-xs flex flex-col items-start gap-1">
      {label}
      <Input
        type="number"
        step="0.01"
        className="h-7 w-16"
        value={prefs[key]}
        onChange={e => {
          const value = Number(e.target.value);
          if (!Number.isNaN(value)) setPrefs({ [key]: value });
        }}
      />
    </Label>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-row flex-wrap gap-2 items-end">
        {field('Plate (mm)', 'probePlateThickness')}
        {field('Travel (mm)', 'probeMaxTravel')}
        {field('Feed', 'probeFeed')}
      </div>
      <p className="text-xs text-muted-foreground">
        Clip on, plate under the bit. Probes down with <code>G38.2</code> and sets Z zero to the plate thickness.
      </p>
    </div>
  );
}

function OverrideSlider({ kind, label }: { kind: 'feed' | 'spindle'; label: string }) {
  'use no memo';
  const api = getCncApi();
  const current = api.overrides.value[kind];
  const [value, setValue] = useState<number | null>(null);
  return (
    <div className="flex flex-row gap-2 items-center">
      <div className="flex-1">
        <Slider
          size="sm"
          label={label}
          minValue={10}
          maxValue={200}
          step={1}
          value={value ?? current}
          onChange={v => setValue(v)}
          onChangeEnd={(v: number | number[]) => {
            setValue(null);
            api.setOverride(kind, Array.isArray(v) ? v[0]! : v);
          }}
          isDisabled={!api.isConnected.value}
        />
      </div>
      {/* The slider label shows the current value; this only resets it. FluidNC clamps feed and spindle overrides to 10-200%. */}
      <Button
        size="sm"
        variant="ghost"
        title="Reset to 100%"
        onClick={() => api.setOverride(kind, 100)}
        disabled={!api.isConnected.value || current === 100}>
        Reset
      </Button>
    </div>
  );
}

export function OverridesPanel() {
  'use no memo';
  const api = getCncApi();
  const rapid = api.overrides.value.rapid;
  return (
    <div className="flex flex-col gap-2">
      <OverrideSlider kind="feed" label="Feed override %" />
      <OverrideSlider kind="spindle" label="Spindle override %" />
      <div className="flex flex-row gap-1 items-center text-xs">
        <span className="text-muted-foreground w-16">Rapids</span>
        {[25, 50, 100].map(pct => (
          <Button key={pct} size="sm" variant={rapid === pct ? 'default' : 'outline'} onClick={() => api.setOverride('rapid', pct)}>
            {pct}%
          </Button>
        ))}
      </div>
    </div>
  );
}

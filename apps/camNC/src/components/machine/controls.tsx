import { getCncApi } from '@/lib/fluidnc/machine';
import {
  kStandardScreenAxes,
  kTopViewCameraRotation,
  axisStepLabel,
  screenAxesForCamera,
  screenToMachine,
  ScreenAxes,
} from '@/scene/topViewOrientation';
import { useCamSource, useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { Slider } from '@wbcnc/ui/components/slider';
import { toast } from '@wbcnc/ui/components/sonner';
import { cn } from '@wbcnc/ui/lib/utils';
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Square } from 'lucide-react';
import { useEffect, useState } from 'react';

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

function StepPicker({ steps, value, onChange, label }: { steps: number[]; value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex flex-row gap-1 items-center">
      <span className="text-xs text-muted-foreground w-6">{label}</span>
      {steps.map(step => (
        <Button key={step} size="sm" variant={step === value ? 'default' : 'outline'} className="px-2 h-7" onClick={() => onChange(step)}>
          {step}
        </Button>
      ))}
    </div>
  );
}

/** Machine axes pointing right / up on screen in Top View, or the standard layout while the camera isn't calibrated. */
const kTopViewScreenAxes = screenAxesForCamera(kTopViewCameraRotation);

function useScreenAxes(): ScreenAxes {
  const camSource = useCamSource();
  return camSource?.extrinsics && camSource.machineBounds ? kTopViewScreenAxes : kStandardScreenAxes;
}

/** Arrow keys jog X/Y in screen directions, PageUp/PageDown jog Z. Holding a key jogs continuously; releasing it cancels the jog. */
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
    const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]');
    const onDown = (e: KeyboardEvent) => {
      const dir = keys[e.key];
      if (!dir || isTyping(e)) return;
      e.preventDefault();
      if (e.repeat || active || !api.canJog.value) return;
      active = e.key;
      const prefs = useStore.getState().machinePrefs;
      // Continuous jog: a long move that is cancelled on key-up (FluidNC limits it to the configured travel).
      const distance = dir.z ? 300 : 3000;
      const feed = dir.z ? prefs.jogFeedZ : prefs.jogFeedXY;
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

export function JogPanel() {
  'use no memo';
  const api = getCncApi();
  const prefs = useStore(s => s.machinePrefs);
  const setPrefs = useStore(s => s.setMachinePrefs);
  const canJog = api.canJog.value;
  const axes = useScreenAxes();
  useKeyboardJog(prefs.keyboardJog && canJog, axes);

  const jog = (dx: number, dy: number, dz = 0) => {
    const xy = prefs.jogStepXY;
    const delta = { x: dx * xy, y: dy * xy, z: dz * prefs.jogStepZ };
    void report(api.jogRelative(delta, dz ? prefs.jogFeedZ : prefs.jogFeedXY), 'Jog');
  };
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-row gap-4 items-start">
        <div className={cn('grid grid-cols-3 gap-1', !canJog && 'opacity-50')}>
          {arrows.map(([sx, sy, icon], i) => {
            if (sx === 0 && sy === 0) {
              return (
                <Button
                  key={i}
                  size="icon"
                  variant="outline"
                  className="size-11"
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
              <Button
                key={i}
                size="icon"
                variant="outline"
                className="size-11 flex-col gap-0"
                disabled={!canJog}
                onClick={() => jog(step.x, step.y)}
                title={`Jog ${label}`}
                aria-label={`Jog ${label}`}>
                {icon}
                {/* Axis buttons only; diagonals keep their label in the tooltip. */}
                {(sx === 0 || sy === 0) && <span className="text-[10px] leading-none font-mono">{label}</span>}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="outline" disabled={!canJog} onClick={() => jog(0, 0, 1)}>
            Z+ <ArrowUp />
          </Button>
          <Button size="sm" variant="outline" disabled={!canJog} onClick={() => jog(0, 0, -1)}>
            Z− <ArrowDown />
          </Button>
        </div>
      </div>
      <StepPicker label="XY" steps={kStepsXY} value={prefs.jogStepXY} onChange={v => setPrefs({ jogStepXY: v })} />
      <StepPicker label="Z" steps={kStepsZ} value={prefs.jogStepZ} onChange={v => setPrefs({ jogStepZ: v })} />
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
      <Label className="text-xs flex flex-row gap-2 items-center">
        <Checkbox checked={prefs.keyboardJog} onCheckedChange={v => setPrefs({ keyboardJog: v === true })} />
        Keyboard jog (arrows as in Top View, PgUp/PgDn = Z, hold to move)
      </Label>
    </div>
  );
}

export function ProbePanel() {
  'use no memo';
  const api = getCncApi();
  const prefs = useStore(s => s.machinePrefs);
  const setPrefs = useStore(s => s.setMachinePrefs);
  const [busy, setBusy] = useState(false);
  const idle = api.state.value === 'Idle';

  async function probe() {
    setBusy(true);
    const promise = api.probeZ({ plateThickness: prefs.probePlateThickness, maxTravel: prefs.probeMaxTravel, feed: prefs.probeFeed });
    toast.promise(promise, {
      loading: 'Probing Z…',
      success: `Z zero set (plate ${prefs.probePlateThickness} mm)`,
      error: err => `Probe failed: ${err instanceof Error ? err.message : err}`,
    });
    await promise.catch(() => {});
    setBusy(false);
  }

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
        <Button size="sm" className="ml-auto" disabled={!idle || busy} onClick={probe}>
          Probe Z
        </Button>
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
      <Button size="sm" variant="ghost" onClick={() => api.setOverride(kind, 100)} disabled={!api.isConnected.value}>
        100%
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

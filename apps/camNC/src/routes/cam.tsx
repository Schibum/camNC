import { PageHeader } from '@/components/page-header';
import { useCamJob, useJob, type MaterialKey, type Side } from '@/cam/camJobStore';
import { openStepFile } from '@/cam/openStepFile';
import type { CamPartSummary, GeneratedJob } from '@/cam/camTypes';
import { fmtMm, PartPreview } from '@/cam/PartPreview';
import { useStore } from '@/store/store';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MATERIALS } from '@wbcnc/cam';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Label } from '@wbcnc/ui/components/label';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Box, Check, Download, FileUp, FlipVertical2, Play, Plus, X } from 'lucide-react';
import { useEffect } from 'react';

export const Route = createFileRoute('/cam')({
  component: CamPage,
});

function CamPage() {
  const { status, parts, fileName, error } = useCamJob();
  return (
    <div className="flex h-dvh flex-col">
      <PageHeader title="Make G-code">
        {fileName && <span className="truncate text-sm text-muted-foreground">{fileName}</span>}
        <Button size="sm" variant="outline" className="ml-2" onClick={openStepFile}>
          <FileUp /> Open STEP
        </Button>
      </PageHeader>
      {status === 'idle' && <EmptyState />}
      {status === 'reading' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner />
          <p>Reading {fileName}…</p>
          <p className="text-xs">The first file loads the CAD kernel (2.3 MB).</p>
        </div>
      )}
      {status === 'error' && <p className="m-8 text-destructive">Could not read the file: {error}</p>}
      {status === 'ready' && parts.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr_320px]">
          <PartList />
          <PartStage />
          <JobPanel />
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <button
        onClick={openStepFile}
        className="flex w-full max-w-xl flex-col items-center gap-3 rounded-xl border-2 border-dashed p-12 text-center hover:bg-muted/50">
        <Box className="size-10 text-muted-foreground" />
        <span className="text-lg font-medium">Drop a STEP file of your project</span>
        <span className="text-sm text-muted-foreground">
          Flat parts (boards, panels) are found automatically. Pockets, holes and outlines become G-code for your machine. Everything stays
          in your browser.
        </span>
      </button>
    </div>
  );
}

function PartList() {
  const { parts, selectedId, select } = useCamJob();
  return (
    <aside className="min-h-0 overflow-y-auto border-r p-2">
      <p className="px-2 pb-2 text-xs font-medium uppercase text-muted-foreground">{parts.reduce((n, p) => n + p.names.length, 0)} parts</p>
      <ul className="space-y-1">
        {parts.map(p => (
          <li key={p.id}>
            <PartCard part={p} selected={p.id === selectedId} onClick={() => select(p.id)} />
          </li>
        ))}
      </ul>
    </aside>
  );
}

function PartCard({ part, selected, onClick }: { part: CamPartSummary; selected: boolean; onClick: () => void }) {
  const top = useJob(part.id, 'top');
  const done = top && top !== 'pending';
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted',
        selected && 'bg-muted ring-1 ring-primary/40'
      )}>
      <PartPreview part={part} className="size-14 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate text-sm font-medium">
          {part.name}
          {part.names.length > 1 && <span className="text-muted-foreground">×{part.names.length}</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{part.size.map(s => +s.toFixed(1)).join(' × ')}</span>
        <span className="mt-1 flex gap-1">
          {part.twoSided && <Badge icon={<FlipVertical2 className="size-3" />}>2 sides</Badge>}
          {part.warnings.length > 0 && !part.twoSided && <Badge icon={<AlertTriangle className="size-3" />}>check</Badge>}
          {done && <Badge icon={<Check className="size-3" />}>{(top as GeneratedJob).timeMin.toFixed(0)} min</Badge>}
        </span>
      </span>
    </button>
  );
}

function Badge({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
      {icon}
      {children}
    </span>
  );
}

function PartStage() {
  const { parts, selectedId, side, select, generate } = useCamJob();
  const part = parts.find(p => p.id === selectedId);
  const job = useJob(selectedId, side);
  // Toolpaths are cheap (~0.3s): generate whenever the selection or options change.
  useEffect(() => {
    if (part && !job) void generate(part.id, side);
  }, [part, job, side, generate]);
  if (!part) return null;
  return (
    <main className="flex min-h-0 flex-col bg-muted/30">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="font-medium">{part.name}</h2>
        <span className="text-sm text-muted-foreground">
          {fmtMm(part.size[0])} × {fmtMm(part.size[1])}, {fmtMm(part.thickness)} thick
        </span>
        {part.twoSided && (
          <div className="ml-auto flex rounded-md bg-background p-0.5 ring-1 ring-border">
            {(['top', 'bottom'] as Side[]).map(s => (
              <button
                key={s}
                onClick={() => select(part.id, s)}
                className={cn('rounded px-2 py-0.5 text-sm', side === s && 'bg-primary text-primary-foreground')}>
                {s === 'top' ? 'Top side' : 'Bottom side (flipped)'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative min-h-0 flex-1 p-6">
        <PartPreview part={part} job={job === 'pending' ? undefined : job} dims className="size-full" />
        {job === 'pending' && (
          <div className="absolute right-4 top-4 flex items-center gap-2 text-sm text-muted-foreground">
            <LoadingSpinner className="size-4" /> Computing toolpaths
          </div>
        )}
      </div>
      <DepthLegend thickness={part.thickness} pockets={part.pockets.map(p => p.z)} />
    </main>
  );
}

function DepthLegend({ thickness, pockets }: { thickness: number; pockets: number[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
      <span>Top {fmtMm(thickness)}</span>
      {pockets.map(z => (
        <span key={z}>
          Pocket floor {fmtMm(z)} ({fmtMm(thickness - z)} deep)
        </span>
      ))}
      <span>Z0 = bottom of the board</span>
    </div>
  );
}

function JobPanel() {
  const navigate = useNavigate();
  const { parts, selectedId, side, options, setOptions } = useCamJob();
  const part = parts.find(p => p.id === selectedId);
  const job = useJob(selectedId, side);
  if (!part) return null;
  const ready = job && job !== 'pending' ? job : undefined;
  const fileName = `${part.name}${side === 'bottom' ? ' bottom' : ''}.gcode`;

  const showOnMachine = () => {
    if (!ready) return;
    useStore.getState().updateToolpath(ready.gcode, fileName);
    void navigate({ to: '/visualize/2DView' });
  };
  const download = () => {
    if (!ready) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ready.gcode], { type: 'text/plain' }));
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <aside className="min-h-0 space-y-5 overflow-y-auto border-l p-4">
      <section className="space-y-2">
        <Label>Material</Label>
        <Select value={options.material} onValueChange={v => setOptions({ material: v as MaterialKey })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MATERIALS).map(([k, m]) => (
              <SelectItem key={k} value={k}>
                {m.name[0].toUpperCase() + m.name.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-2">
        <Label>Bits</Label>
        <div className="flex flex-wrap gap-1.5">
          {options.bits.map(b => (
            <span key={b.number} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
              ⌀ {b.diameter} mm flat
              {options.bits.length > 1 && (
                <button
                  aria-label="Remove bit"
                  onClick={() => setOptions({ bits: options.bits.filter(x => x !== b) })}
                  className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {[3, 6].some(d => !options.bits.some(b => b.diameter === d)) && (
            <button
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground ring-1 ring-border hover:bg-muted"
              onClick={() => {
                const d = options.bits.some(b => b.diameter === 3) ? 6 : 3;
                const number = Math.max(...options.bits.map(b => b.number)) + 1;
                setOptions({ bits: [...options.bits, { number, diameter: d, name: 'flat end mill' }] });
              }}>
              <Plus className="size-3" /> Add bit
            </button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <CheckRow
          id="tabs"
          checked={options.tabs}
          onChange={tabs => setOptions({ tabs })}
          label="Holding tabs"
          hint="Leaves 2 mm bridges so the part can't move on the last pass."
        />
        <CheckRow
          id="gentle"
          checked={options.gentleFinish}
          onChange={gentleFinish => setOptions({ gentleFinish })}
          label="Slow final pass"
          hint="Last outline pass at half speed for a clean edge."
        />
      </section>

      <section className="space-y-2">
        <Label>Operations</Label>
        {!ready && <p className="text-sm text-muted-foreground">Computing…</p>}
        {ready && (
          <ol className="space-y-1 text-sm">
            {ready.operations.map((op, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {i + 1}. {opLabel(op.name, part.thickness)}
                </span>
                <span className="text-muted-foreground">⌀{op.tool.diameter}</span>
              </li>
            ))}
            <li className="flex justify-between border-t pt-1 font-medium">
              <span>Estimated time</span>
              <span>{ready.timeMin.toFixed(0)} min</span>
            </li>
          </ol>
        )}
      </section>

      {(part.warnings.length > 0 || (ready?.warnings.length ?? 0) > 0) && (
        <section className="space-y-1 rounded-md bg-amber-500/10 p-3 text-sm">
          {[...part.warnings, ...(ready?.warnings ?? [])].map(w => (
            <p key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> {w}
            </p>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <Button className="w-full" disabled={!ready} onClick={showOnMachine}>
          <Play /> Place on machine
        </Button>
        <Button className="w-full" variant="outline" disabled={!ready} onClick={download}>
          <Download /> Download G-code
        </Button>
      </section>
    </aside>
  );
}

/** "Pocket 2 z=3.5" -> "Pockets, 4.5 mm deep"; "Outline 1" -> "Cut out". */
function opLabel(name: string, thickness: number) {
  const z = name.match(/z=([\d.]+)/);
  if (z) return `Pockets, ${+(thickness - +z[1]).toFixed(2)} mm deep`;
  if (name.startsWith('Hole')) return 'Through hole';
  if (name.startsWith('Outline')) return 'Cut out';
  return name;
}

function CheckRow(props: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex gap-2">
      <Checkbox id={props.id} checked={props.checked} onCheckedChange={v => props.onChange(v === true)} className="mt-0.5" />
      <div>
        <Label htmlFor={props.id}>{props.label}</Label>
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      </div>
    </div>
  );
}

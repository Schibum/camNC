import { getCncApi } from '@/lib/fluidnc/machine';
import { useStore } from '@/store/store';
import { openGcodeFile } from '@/visualize/openGcodeFile';
import { Button } from '@wbcnc/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@wbcnc/ui/components/collapsible';
import { Input } from '@wbcnc/ui/components/input';
import { cn } from '@wbcnc/ui/lib/utils';
import { ChevronRight, FolderOpen, Wrench } from 'lucide-react';
import { useState } from 'react';
import { AlarmCard } from './AlarmCard';
import { JogFeeds, JogPanel, ProbeSettings } from './controls';
import { MacroButtons } from './macros';
import { ResumeJobCard } from './ResumeJobCard';
import { CamQueueCard } from '@/cam/machine/CamQueueCard';
import { useCamMachine } from '@/cam/machine/camMachine';
import { RunFooter } from './RunFooter';
import { SetupStep } from './SetupStep';

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-row items-center justify-between min-h-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Without a CAM job: the G-code file and the stock it's cut from. */
function JobStep() {
  const name = useStore(s => s.toolpathName);
  const hasToolpath = useStore(s => !!s.toolpath);
  const stockHeight = useStore(s => s.stockHeight);
  const setStockHeight = useStore(s => s.setStockHeight);
  const offset = useStore(s => s.toolpathOffset);
  return (
    <SetupStep
      label="Job"
      state={hasToolpath && stockHeight > 0 ? 'done' : 'todo'}
      title={<span className="truncate">{hasToolpath ? (name ?? 'Program loaded') : 'Open a G-code file'}</span>}
      summary={hasToolpath && stockHeight > 0 ? `stock ${stockHeight} mm` : undefined}
      action={
        <Button size="sm" variant="outline" onClick={openGcodeFile}>
          <FolderOpen /> Open…
        </Button>
      }>
      <div className="flex flex-row items-center gap-2">
        <span className="flex-1">Stock height</span>
        <Input
          type="number"
          step="0.1"
          min={0}
          className="h-7 w-20"
          aria-label="Stock height (mm)"
          value={stockHeight}
          onChange={e => {
            const value = Number(e.target.value);
            if (!Number.isNaN(value) && value >= 0) setStockHeight(value);
          }}
        />
        <span className="text-xs text-muted-foreground">mm</span>
      </div>
      {hasToolpath && (
        <p className="text-xs text-muted-foreground">
          Placed at X {offset.x.toFixed(2)} Y {offset.y.toFixed(2)}. Drag it on the camera view to place it roughly.
        </p>
      )}
    </SetupStep>
  );
}

/** Always in view while preparing: moving the bit is part of placing the board and zeroing. */
function JogStep({ onEditMacros }: { onEditMacros: () => void }) {
  return (
    <section aria-label="Jog" className="flex flex-col gap-2 rounded-lg border px-3 py-2">
      <JogPanel />
      <MacroButtons onEdit={onEditMacros} />
    </section>
  );
}

/** Rarely changed settings, out of the way of the job. */
function ToolsDrawer() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-1 self-start px-1 text-muted-foreground">
          <ChevronRight className={cn('transition-transform', open && 'rotate-90')} /> <Wrench /> Tools: feeds, probe
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4">
        {open && (
          <>
            <Section title="Jog feed">
              <JogFeeds />
            </Section>
            <Section title="Probe">
              <ProbeSettings />
            </Section>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Everything before a job, as steps: the job (a CAM job's queue and board, or a G-code file), jog with the macros, and
 * the footer pinned at the bottom with what's next. Rarely changed settings are folded away.
 */
export function SetupView({ onEditMacros, onShowConsole }: { onEditMacros: () => void; onShowConsole?: () => void }) {
  'use no memo';
  const connected = getCncApi().isConnected.value;
  const camJob = !!useCamMachine(s => s.jobId);
  return (
    <div className="flex min-h-full flex-col gap-3">
      <AlarmCard onShowConsole={onShowConsole} />
      <ResumeJobCard />
      {camJob ? <CamQueueCard /> : <JobStep />}
      {connected && (
        <>
          <JogStep onEditMacros={onEditMacros} />
          <ToolsDrawer />
          <RunFooter />
        </>
      )}
    </div>
  );
}

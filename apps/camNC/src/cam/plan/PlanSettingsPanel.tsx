import { MATERIALS, parseFusionToolLibrary, type LibraryTool } from '@wbcnc/cam';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { toast } from '@wbcnc/ui/components/sonner';
import { kDefaultBit, type MaterialKey, type PlanSettingsV1 } from '../planSettings';
import { useToolLibrary } from '../toolLibrary';

const bitKey = (b: LibraryTool) => `${b.number}|${b.diameter}|${b.name}`;
const bitLabel = (b: LibraryTool) => `⌀ ${b.diameter} · ${b.name}`;

function importFusionLibrary(setTools: (t: LibraryTool[], source: string) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.tools';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const tools = parseFusionToolLibrary(await file.text());
      if (!tools.length) return toast.error('No flat end mills in that library.');
      setTools(tools, file.name);
      toast.success(`Imported ${tools.length} flat end mills from ${file.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  input.click();
}

/** Bit, material, final pass and tabs: everything the Plan step needs from the user, with Fusion-like defaults. */
export function PlanSettingsPanel({ value, onChange }: { value: PlanSettingsV1; onChange: (v: PlanSettingsV1) => void }) {
  const { tools, source, setTools } = useToolLibrary();
  const bits = [kDefaultBit, ...tools.filter(t => bitKey(t) !== bitKey(kDefaultBit))];
  if (!bits.some(b => bitKey(b) === bitKey(value.bit))) bits.push(value.bit);
  const set = (patch: Partial<PlanSettingsV1>) => onChange({ ...value, ...patch });
  const feed = value.bit.feed ?? 1800;

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l p-4">
      <h2 className="text-[15px] font-semibold">Settings</h2>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="plan-bit">Bit</Label>
        <Select value={bitKey(value.bit)} onValueChange={k => set({ bit: bits.find(b => bitKey(b) === k)! })}>
          <SelectTrigger id="plan-bit" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bits.map(b => (
              <SelectItem key={bitKey(b)} value={bitKey(b)}>
                {bitLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Flat end mill, F{feed}, plunge F{value.bit.plungeFeed ?? 480}
          {source ? ` · library: ${source}` : ''}
        </p>
        <Button variant="outline" size="sm" className="self-start" onClick={() => importFusionLibrary(setTools)}>
          Import Fusion tool library…
        </Button>
      </section>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="plan-material">Material</Label>
        <Select value={value.material} onValueChange={m => set({ material: m as MaterialKey })}>
          <SelectTrigger id="plan-material" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MATERIALS).map(([k, m]) => (
              <SelectItem key={k} value={k}>
                {m.name[0].toUpperCase() + m.name.slice(1)} · stepdown {m.stepdownFactor} × ⌀
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Pockets go {+(MATERIALS[value.material].stepdownFactor * value.bit.diameter).toFixed(2)} mm deeper per pass.
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="plan-final-feed">Final pass feed</Label>
        <Select value={String(value.finalFeedFactor)} onValueChange={f => set({ finalFeedFactor: +f })}>
          <SelectTrigger id="plan-final-feed" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0.5">½ ({feed / 2}) · cleaner edge</SelectItem>
            <SelectItem value="1">Full ({feed})</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="plan-cut-below">Cut through to (mm below the board)</Label>
        <Input
          id="plan-cut-below"
          type="number"
          min={0}
          max={2}
          step={0.1}
          className="font-mono"
          value={value.cutBelow}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0 && v <= 2) set({ cutBelow: v });
          }}
        />
        <p className="text-xs text-muted-foreground">The final pass ends at Z−{value.cutBelow}, in the spoilboard.</p>
      </section>

      <div className="flex gap-2">
        <Checkbox id="plan-tabs" checked={value.tabs} onCheckedChange={v => set({ tabs: v === true })} className="mt-0.5" />
        <div>
          <Label htmlFor="plan-tabs">Holding tabs</Label>
          <p className="text-xs text-muted-foreground">5 mm long, 2 mm high, at least 3, so the part stays put on the last pass.</p>
        </div>
      </div>

      <span className="grow" />
      <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        Defaults follow your Fusion jobs: Z0 at the bottom of the board, roughing to +1 mm leaving 0.1 mm, one final pass through, climb
        cut.
      </p>
    </aside>
  );
}

import { getCncApi } from '@/lib/fluidnc/machine';
import { errorText, runMacro } from '@/lib/machine/jobs';
import { kDefaultMacros, Macro, MacroKind, parseWebUiMacros } from '@/lib/machine/macros';
import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { toast } from '@wbcnc/ui/components/sonner';
import { Textarea } from '@wbcnc/ui/components/textarea';
import { Download, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

const kKindLabels: Record<MacroKind, string> = {
  gcode: 'G-code / commands',
  sd: 'Run file from SD card',
  localfs: 'Run file from controller flash',
};

function MacroEditor({ macro, onSave, onClose }: { macro: Macro; onSave: (macro: Macro) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(macro);
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={e => {
            e.preventDefault();
            if (!draft.name.trim() || !draft.content.trim()) return;
            onSave({ ...draft, name: draft.name.trim() });
          }}>
          <DialogHeader>
            <DialogTitle>{macro.name ? 'Edit macro' : 'New macro'}</DialogTitle>
            <DialogDescription>Macros run line by line and stop at the first error.</DialogDescription>
          </DialogHeader>
          <Label className="flex flex-col items-start gap-1">
            Name
            <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} autoFocus />
          </Label>
          <Label className="flex flex-col items-start gap-1">
            Type
            <Select value={draft.kind} onValueChange={kind => setDraft({ ...draft, kind: kind as MacroKind })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(kKindLabels).map(([kind, label]) => (
                  <SelectItem key={kind} value={kind}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="flex flex-col items-start gap-1">
            {draft.kind === 'gcode' ? 'Commands (one per line)' : 'File path'}
            {draft.kind === 'gcode' ? (
              <Textarea
                className="font-mono"
                rows={6}
                value={draft.content}
                onChange={e => setDraft({ ...draft, content: e.target.value })}
                placeholder={'G91\nG0 Z10\nG90'}
              />
            ) : (
              <Input value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} placeholder="/park.nc" />
            )}
          </Label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const macros = useStore(s => s.macros);
  const setMacros = useStore(s => s.setMacros);
  const [json, setJson] = useState('');

  function importJson(text: string) {
    try {
      const imported = parseWebUiMacros(text);
      if (!imported.length) {
        toast.error('No macros found');
        return;
      }
      setMacros([...macros, ...imported]);
      toast.success(`Imported ${imported.length} macro${imported.length === 1 ? '' : 's'}`);
      onClose();
    } catch (err) {
      toast.error('Could not read preferences.json', { description: errorText(err) });
    }
  }

  async function readFromController() {
    try {
      importJson(await getCncApi().readLocalFile('/preferences.json'));
    } catch (err) {
      toast.error('Could not read /preferences.json from the controller', { description: errorText(err) });
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import WebUI macros</DialogTitle>
          <DialogDescription>
            The FluidNC WebUI stores its macros in <code>preferences.json</code> on the controller. Read it directly, or paste its contents.
          </DialogDescription>
        </DialogHeader>
        <Button variant="outline" disabled={!getCncApi().isConnected.value} onClick={readFromController}>
          <Download /> Read from controller
        </Button>
        <Textarea rows={6} className="font-mono text-xs" placeholder="{ … }" value={json} onChange={e => setJson(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!json.trim()} onClick={() => importJson(json)}>
            Import pasted JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MacroButtons() {
  'use no memo';
  const macros = useStore(s => s.macros);
  const api = getCncApi();
  const idle = api.state.value === 'Idle';
  return (
    <div className="flex flex-row flex-wrap gap-1" data-testid="macro-buttons">
      {macros.map(macro => (
        <Button key={macro.id} size="sm" variant="secondary" disabled={!idle} title={macro.content} onClick={() => runMacro(macro)}>
          {macro.name}
        </Button>
      ))}
      {macros.length === 0 && <span className="text-xs text-muted-foreground">No macros yet</span>}
    </div>
  );
}

/** Edit, reorder, import and reset macros. Running them is done with {@link MacroButtons}. */
export function MacroManager() {
  const macros = useStore(s => s.macros);
  const setMacros = useStore(s => s.setMacros);
  const [editing, setEditing] = useState<Macro | null>(null);
  const [importing, setImporting] = useState(false);

  function save(macro: Macro) {
    const exists = macros.some(m => m.id === macro.id);
    setMacros(exists ? macros.map(m => (m.id === macro.id ? macro : m)) : [...macros, macro]);
    setEditing(null);
  }

  function move(index: number, delta: number) {
    const next = [...macros];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item!);
    setMacros(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <ul className="flex flex-col divide-y text-sm">
          {macros.map((macro, i) => (
            <li key={macro.id} className="flex flex-row items-center gap-1 py-1">
              <span className="flex-1 truncate">{macro.name}</span>
              <span className="text-xs text-muted-foreground">{macro.kind === 'gcode' ? '' : macro.kind.toUpperCase()}</span>
              <Button size="icon" variant="ghost" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </Button>
              <Button size="icon" variant="ghost" title="Edit" onClick={() => setEditing(macro)}>
                <Pencil />
              </Button>
              <Button size="icon" variant="ghost" title="Delete" onClick={() => setMacros(macros.filter(m => m.id !== macro.id))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-row flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', kind: 'gcode', content: '' })}>
            <Plus /> New macro
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
            <Download /> Import from WebUI
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMacros(kDefaultMacros)}>
            <RotateCcw /> Reset to LowRider defaults
          </Button>
        </div>
      </section>
      {editing && <MacroEditor macro={editing} onSave={save} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

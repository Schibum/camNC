import { getCncApi } from '@/lib/fluidnc/machine';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { useState } from 'react';

/** Read-only view of the running configuration. Editing stays in the WebUI. */
export function ConfigView() {
  'use no memo';
  const api = getCncApi();
  const [config, setConfig] = useState<string | null>(null);
  const idle = api.isConnected.value && api.state.value === 'Idle';
  const v3 = api.variant.value === 'v3-81';
  async function load() {
    try {
      setConfig(await api.readConfigText());
    } catch (err) {
      toast.error('Could not read the configuration', { description: err instanceof Error ? err.message : String(err) });
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-row gap-2 items-center">
        <Button size="sm" variant="outline" disabled={!idle} onClick={load}>
          {config ? 'Reload' : 'Read'} config ($CD)
        </Button>
        <span className="text-xs text-muted-foreground">Firmware settings, Wi-Fi and updates stay in the FluidNC WebUI.</span>
      </div>
      {v3 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          FluidNC 3.9.x sends the whole configuration in one go, which can take a while and keeps the controller busy. Only read it while
          the machine is idle.
        </p>
      )}
      {config && <pre className="text-xs font-mono whitespace-pre overflow-auto max-h-[60vh] rounded border p-2 bg-muted/30">{config}</pre>}
    </div>
  );
}

import { ConnectionState } from '@/lib/fluidnc/cnc-api';
import { getCncApi } from '@/lib/fluidnc/machine';
import { hostBlockedReason, machineSupport } from '@/lib/fluidnc/machine-support';
import { useStore } from '@/store/store';
import { Alert, AlertDescription, AlertTitle } from '@wbcnc/ui/components/alert';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { useState } from 'react';
import { MachinePanel } from './MachinePanel';
import { ConnectionBadge } from './MachineStatusBar';

const kHelp: Partial<Record<ConnectionState, { title: string; text: string }>> = {
  'permission-denied': {
    title: 'Local network access is blocked',
    text: 'Chrome asked for permission to reach devices on your local network and it was denied. Allow it via the site settings (lock icon in the address bar → Local network access), then reconnect.',
  },
  unreachable: {
    title: 'Controller not reachable',
    text: 'Check the IP address (shown on the FluidNC WebUI or your router), that the controller is powered and in STA mode, and that this computer is on the same network. Browser and controller must be on the same LAN.',
  },
  'other-tab': {
    title: 'Machine is used by another camNC tab',
    text: 'Only one tab can control the machine. Close the other tab and this one takes over automatically.',
  },
};

export function MachineConnectionForm() {
  'use no memo';
  const support = machineSupport();
  const machine = useStore(s => s.machine);
  const setMachine = useStore(s => s.setMachine);
  const [host, setHost] = useState(machine?.host ?? '');
  const [panelOpen, setPanelOpen] = useState(false);
  const cncApi = getCncApi();
  const connection = cncApi.connection.value;
  const firmware = cncApi.firmware.value;
  const variant = cncApi.variant.value;
  const blocked = hostBlockedReason(host);

  if (!support.supported) {
    return (
      <Alert>
        <AlertTitle>Machine control is not available in this browser</AlertTitle>
        <AlertDescription>{support.reason} camNC still works as a viewer.</AlertDescription>
      </Alert>
    );
  }

  function connect(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = host.trim();
    if (!trimmed || hostBlockedReason(trimmed)) return;
    // Force a fresh connect (and variant detection) even if the host did not change.
    if (machine?.host === trimmed) {
      cncApi.disconnect();
      cncApi.connect(trimmed, machine.variant);
    } else {
      setMachine({ host: trimmed });
    }
  }

  const help = kHelp[connection];
  return (
    <>
      <form onSubmit={connect} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="machine-host">Controller IP address</Label>
          <div className="flex flex-row gap-2">
            <Input
              id="machine-host"
              placeholder="192.168.1.20"
              value={host}
              onChange={e => setHost(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={!host.trim() || !!blocked}>
              Connect
            </Button>
            {machine && (
              <Button type="button" variant="outline" onClick={() => setMachine(null)}>
                Forget
              </Button>
            )}
          </div>
          {blocked && (
            <p role="alert" className="text-xs text-destructive">
              {blocked}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Use the IP address. Chrome blocks router names like <code>fluidnc.fritz.box</code> from the HTTPS app, and <code>.local</code>{' '}
            names do not resolve reliably on Android and Windows. Chrome will ask to allow access to devices on your local network.
          </p>
        </div>
        <div className="flex flex-row gap-2 items-center text-sm">
          <ConnectionBadge />
          {connection === 'connected' && (
            <Button type="button" size="sm" variant="outline" className="ml-auto order-last" onClick={() => setPanelOpen(true)}>
              Open machine panel
            </Button>
          )}
          {connection === 'connected' && (
            <span className="text-muted-foreground">
              FluidNC {firmware?.version ?? 'unknown version'} ·{' '}
              {variant === 'v4' ? 'WebSocket on the HTTP port' : 'WebSocket on HTTP port + 1 (3.9.x)'}
            </span>
          )}
        </div>
        {help && !blocked && (
          <Alert variant="destructive">
            <AlertTitle>{help.title}</AlertTitle>
            <AlertDescription>{help.text}</AlertDescription>
          </Alert>
        )}
      </form>
      <MachinePanel open={panelOpen} onOpenChange={setPanelOpen} />
    </>
  );
}

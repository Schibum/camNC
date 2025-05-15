import { getFluidNcClient } from '@/fluidnc-hooks';
import { CopyButton } from '@wbcnc/ui/components/copy-button';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';

const kFluidNcIntegrationBaseUrl = 'https://fluidnc-integration.vercel.app';
export function FluidNcUrlCopyInput() {
  'use no memo';
  const client = getFluidNcClient();
  const widgetUrl = `${kFluidNcIntegrationBaseUrl}/${client.accessToken}`;
  return (
    <div className="flex flex-col gap-2">
      <Label>Widget URL</Label>
      <div className="flex flex-row gap-2">
        <Input type="text" value={widgetUrl} readOnly onClick={ev => (ev.target as HTMLInputElement).select()} className="flex" />
        <CopyButton value={widgetUrl} />
      </div>

      <div className="flex flex-row gap-2 items-center">
        <span
          className={`inline-block mt-1 px-3 py-1 text-xs font-semibold rounded-full ${
            client.isConnected.value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
          {client.isConnected.value ? 'Connected' : 'Disconnected'}
        </span>
      </div>
    </div>
  );
}

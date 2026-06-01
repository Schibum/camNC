import { usePnPResult, useStore } from '@/store/store';
import { ClientOnly } from '@tanstack/react-router';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { Info } from 'lucide-react';
import { useState } from 'react';
import TimeAgo from 'react-timeago-i18n';
import { RecomputePnpButton } from './RecomputePnpButton';
import { TooltipIconButton } from './toolbar/TooltipIconButton';

export function BoundsInfo() {
  const bounds = useStore(s => s.toolpath?.getBounds());
  const pnpResult = usePnPResult();
  const isOld = pnpResult ? Date.now() - pnpResult.lastPnPTime > 60_000 : false;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Toolpath Bounds</h3>
      {bounds ? (
        <>
          <div className="grid gap-0.5 text-xs text-gray-600">
            <div>
              X: [{bounds.min.x.toFixed(2)}, {bounds.max.x.toFixed(2)}]
            </div>
            <div>
              Y: [{bounds.min.y.toFixed(2)}, {bounds.max.y.toFixed(2)}]
            </div>
            <div>
              Z: [{bounds.min.z.toFixed(2)}, {bounds.max.z.toFixed(2)}]
            </div>
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-600">No toolpath loaded</div>
      )}
      {pnpResult && (
        <>
          <h3 className="text-sm font-medium">PnP</h3>
          <div className="grid items-center gap-0.5 text-xs">
            <ClientOnly>
              <div className={`flex items-center gap-1 ${isOld ? 'bg-warning' : ''}`}>
                <span>
                  PnP computed <TimeAgo date={pnpResult.lastPnPTime} hideSeconds={false} />
                </span>
                <RecomputePnpButton />
              </div>
            </ClientOnly>
            {pnpResult.lastReprojectionError !== undefined && (
              <div className={pnpResult.lastReprojectionError > 2 ? 'text-red-600' : ''}>
                Reprojection error: {pnpResult.lastReprojectionError.toFixed(2)}px
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function BoundsInfoButton() {
  const [open, setOpen] = useState(false);
  const pnp = usePnPResult();
  const isOld = pnp ? Date.now() - pnp.lastPnPTime > 60_000 : false;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <TooltipIconButton
            label="Info"
            icon={<Info />}
            shortcut="i"
            onClick={() => setOpen(true)}
            className={isOld ? 'bg-warning' : ''}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent>
        <BoundsInfo />
      </PopoverContent>
    </Popover>
  );
}

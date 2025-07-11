import TimeAgo from 'react-timeago';
import { useLastPnPTime, useReprojectionError, useStore } from '@/store/store';

export function BoundsInfo() {
  const bounds = useStore(s => s.toolpath?.getBounds());
  const lastPnP = useLastPnPTime();
  const reproErr = useReprojectionError();
  if (!bounds) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Toolpath Bounds</h3>
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
      {lastPnP && (
        <div className="text-xs mt-1">
          PnP computed <TimeAgo date={lastPnP} />
          {typeof reproErr === 'number' && <> – error: {reproErr.toFixed(2)}px</>}
        </div>
      )}
    </div>
  );
}

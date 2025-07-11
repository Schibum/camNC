import { usePnPResult, useStore } from '@/store/store';
import TimeAgo from 'react-timeago';

export function BoundsInfo() {
  const bounds = useStore(s => s.toolpath?.getBounds());
  const pnpResult = usePnPResult();
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
            <div>
              PnP computed <TimeAgo date={pnpResult.lastPnPTime} />
            </div>
            {pnpResult.lastReprojectionError !== undefined && <div>Reprojection error: {pnpResult.lastReprojectionError.toFixed(2)}px</div>}
          </div>
        </>
      )}
    </div>
  );
}

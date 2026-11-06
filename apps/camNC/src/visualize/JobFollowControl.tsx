import { cn } from '@wbcnc/ui/lib/utils';
import { Locate, LocateOff } from 'lucide-react';
import { useDepthView } from './depthViewStore';
import { useJobActive } from './useJobFollowCamera';

/** While a job runs: whether the 3D view follows the part being cut, and getting back to the automatic view. */
export function JobFollowControl() {
  'use no memo';
  const jobActive = useJobActive();
  const follow = useDepthView(s => s.followCamera);
  const customView = useDepthView(s => s.followCustomView);
  const { setFollowCamera, setFollowCustomView } = useDepthView.getState();
  if (!jobActive) return null;
  return (
    <div className="dark pointer-events-auto flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/75 p-1 text-xs text-foreground shadow-lg shadow-black/30 backdrop-blur-md">
      <button
        type="button"
        aria-pressed={follow}
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-0.5',
          follow ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/50' : 'hover:bg-white/10'
        )}
        onClick={() => setFollowCamera(!follow)}>
        {follow ? <Locate className="size-3.5" /> : <LocateOff className="size-3.5" />}
        {follow ? 'Following part' : 'Resume follow'}
      </button>
      {follow && customView && (
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-white/10"
          onClick={() => setFollowCustomView(false)}>
          Reset view
        </button>
      )}
    </div>
  );
}

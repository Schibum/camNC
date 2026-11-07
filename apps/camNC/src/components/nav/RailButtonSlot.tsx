import { lazy, Suspense } from 'react';
import { useAppRail } from './appRailStore';

const HiddenRailButton = lazy(() => import('./AppRail').then(m => ({ default: m.HiddenRailButton })));

/** Where a top bar shows the way back to the navigation, once the left panel is hidden. */
export function RailButtonSlot({ className }: { className?: string }) {
  const hidden = useAppRail(s => s.rail === 'hidden');
  if (!hidden) return null;
  return (
    <Suspense fallback={null}>
      <HiddenRailButton className={className} />
    </Suspense>
  );
}

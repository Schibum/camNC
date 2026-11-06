import { Button } from '@wbcnc/ui/components/button';
import { FlaskConical } from 'lucide-react';
import { leaveRehearsal } from '../rehearsal/rehearsal';
import { exitDemo, getRehearsalId, isDemoMode } from './demo-mode';

/**
 * The demo bar belongs to the machine view. Other pages say in their header that nothing is saved here, and offer the
 * way out, without covering the page. Renders nothing outside demo mode.
 */
export function DemoHeaderMark() {
  if (!isDemoMode()) return null;
  const rehearsal = !!getRehearsalId();
  return (
    <div className="ml-auto mr-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1 whitespace-nowrap">
        <FlaskConical className="size-3.5" /> {rehearsal ? 'Rehearsal' : 'Demo'} · not saved
      </span>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => (rehearsal ? void leaveRehearsal() : exitDemo('/'))}>
        {rehearsal ? 'Return to CAM' : 'Exit'}
      </Button>
    </div>
  );
}

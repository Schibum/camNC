import { Button } from '@wbcnc/ui/components/button';
import { FlaskConical } from 'lucide-react';
import { leaveRehearsal } from '../rehearsal/rehearsal';
import { exitDemo, getRehearsalId, isDemoMode } from './demo-mode';

/**
 * The demo bar belongs to the machine view. Other pages identify the simulated context and offer
 * a way out without covering the page. Ordinary demo projects save locally; rehearsals are temporary.
 */
export function DemoHeaderMark() {
  if (!isDemoMode()) return null;
  const rehearsal = !!getRehearsalId();
  return (
    <div className="ml-auto mr-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1 whitespace-nowrap">
        <FlaskConical className="size-3.5" /> {rehearsal ? 'Rehearsal · not saved' : 'Demo · local projects'}
      </span>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => (rehearsal ? void leaveRehearsal() : exitDemo('/'))}>
        {rehearsal ? 'Return to CAM' : 'Exit'}
      </Button>
    </div>
  );
}

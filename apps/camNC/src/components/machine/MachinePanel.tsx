import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@wbcnc/ui/components/sheet';
import { MachinePanelContent } from './MachinePanelContent';

/** The machine panel as a sheet, for pages without the docked panel (e.g. the connection step). */
export function MachinePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent side="right" className="w-full sm:max-w-sm p-0 gap-0 [&>button]:hidden" onInteractOutside={e => e.preventDefault()}>
        <SheetTitle className="sr-only">Machine</SheetTitle>
        <SheetDescription className="sr-only">Machine control</SheetDescription>
        <MachinePanelContent onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

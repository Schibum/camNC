import { useStore } from '@/store/store';
import { MachinePanelContent } from './MachinePanelContent';

/** The machine panel docked next to the camera view (a bottom sheet on phones), so the view stays usable. */
export function MachineDock() {
  const open = useStore(s => s.machinePanelOpen);
  const setOpen = useStore(s => s.setMachinePanelOpen);
  if (!open) return null;
  return (
    <aside
      className="bg-background shrink-0 w-[22rem] h-dvh border-l max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[60dvh] max-sm:w-full max-sm:border-l-0 max-sm:border-t max-sm:z-30 max-sm:rounded-t-xl max-sm:shadow-lg"
      aria-label="Machine panel">
      <MachinePanelContent onClose={() => setOpen(false)} />
    </aside>
  );
}

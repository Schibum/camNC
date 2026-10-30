import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from '@wbcnc/ui/components/sonner';

interface ReadyUpdate {
  version: string;
}

function offerRestart({ version }: ReadyUpdate) {
  // Stays until dismissed: restarting is up to the user, e.g. not in the middle of a job.
  toast.info(`camNC ${version} is ready`, {
    id: 'desktop-update',
    description: 'Restart the app to use the new version.',
    duration: Infinity,
    action: {
      label: 'Restart',
      onClick: () => {
        invoke('restart_to_update').catch(err => toast.error(`Update failed: ${err}`));
      },
    },
  });
}

/** Offers a restart once the desktop app has downloaded an update (release builds check for them on their own). */
export function watchForUpdates() {
  void listen<ReadyUpdate>('update-ready', event => offerRestart(event.payload));
  // An update that was ready before the page started listening.
  invoke<ReadyUpdate | null>('ready_update')
    .then(update => update && offerRestart(update))
    .catch(() => undefined);
}

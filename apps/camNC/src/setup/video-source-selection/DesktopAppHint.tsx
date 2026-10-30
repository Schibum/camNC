import { isDesktopApp, kDesktopDownloadUrl } from '@/lib/desktop/is-desktop';
import { Alert, AlertDescription } from '@wbcnc/ui/components/alert';
import { MonitorDown } from 'lucide-react';

/** In the web app: points out that the desktop app connects to IP cameras without a go2rtc setup. */
export function DesktopAppHint() {
  if (isDesktopApp()) return null;
  return (
    <Alert>
      <MonitorDown />
      <AlertDescription>
        <p>
          No go2rtc setup needed with the{' '}
          <a className="text-blue-500 hover:underline" href={kDesktopDownloadUrl} target="_blank" rel="noreferrer">
            camNC desktop app
          </a>
          : it finds IP cameras on your network and connects to them directly, without a Raspberry Pi or other gateway.
        </p>
      </AlertDescription>
    </Alert>
  );
}

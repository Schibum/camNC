import { isDepthBlendSupported } from '@/depth/depthBlendManager';
import { useDepthBlendEnabled, useDepthBlendInitializing, useSetDepthBlendEnabled } from '@/store/store';
import { ClientOnly } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import { TooltipIconButton } from './TooltipIconButton';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';

export function DepthBlendButton() {
  const enabled = useDepthBlendEnabled();
  const initializing = useDepthBlendInitializing();
  const setEnabled = useSetDepthBlendEnabled();

  const toggleBlend = () => setEnabled(!enabled);

  return (
    <ClientOnly>
      {isDepthBlendSupported() && (
        <TooltipIconButton
          label={
            enabled
              ? initializing
                ? 'Preparing Hide‑Machine (first run may download model)'
                : 'Disable Hide‑Machine'
              : 'Enable Hide‑Machine'
          }
          icon={
            initializing && enabled ? <LoadingSpinner className="text-primary" /> : <Layers className={enabled ? 'text-primary' : ''} />
          }
          shortcut="m"
          onClick={toggleBlend}
        />
      )}
    </ClientOnly>
  );
}

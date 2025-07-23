import { isDepthBlendSupported } from '@/depth/depthBlendManager';
import { useDepthBlendEnabled, useSetDepthBlendEnabled } from '@/store/store';
import { ClientOnly } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import { TooltipIconButton } from './TooltipIconButton';

export function DepthBlendButton() {
  const enabled = useDepthBlendEnabled();
  const setEnabled = useSetDepthBlendEnabled();

  const toggleBlend = () => setEnabled(!enabled);

  return (
    <ClientOnly>
      {isDepthBlendSupported() && (
        <TooltipIconButton
          label={enabled ? 'Disable Hide-Machine' : 'Enable Hide-Machine'}
          icon={<Layers className={enabled ? 'text-primary' : ''} />}
          shortcut="m"
          onClick={toggleBlend}
        />
      )}
    </ClientOnly>
  );
}

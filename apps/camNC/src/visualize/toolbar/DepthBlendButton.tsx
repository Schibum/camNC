import { useDepthBlendEnabled, useSetDepthBlendEnabled } from '@/store/store';
import { Layers } from 'lucide-react';
import { TooltipIconButton } from './TooltipIconButton';

export function DepthBlendButton() {
  const enabled = useDepthBlendEnabled();
  const setEnabled = useSetDepthBlendEnabled();

  const toggleBlend = () => setEnabled(!enabled);

  return (
    <TooltipIconButton
      label={enabled ? 'Disable Hide-Machine' : 'Enable Hide-Machine'}
      icon={<Layers className={enabled ? 'text-primary' : ''} />}
      shortcut="m"
      onClick={toggleBlend}
    />
  );
}

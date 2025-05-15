import { getCncApi } from '@/fluidnc-hooks';
import { useStore } from '@/store';
import { toast } from '@wbcnc/ui/components/sonner';
import { CircleOff } from 'lucide-react';
import { useState } from 'react';
import { TooltipIconButton } from './TooltipIconButton';

export function SetZeroButton() {
  const [isLoading, setIsLoading] = useState(false);
  const toolpathOffset = useStore(s => s.toolpathOffset);
  const cncApi = getCncApi();

  function onClick() {
    setIsLoading(true);
    const promise = cncApi.setWorkspaceXYZero(toolpathOffset.x, toolpathOffset.y);
    toast.promise(promise, {
      loading: 'Setting zero...',
      success: `Zero set to ${toolpathOffset.x.toFixed(2)}, ${toolpathOffset.y.toFixed(2)}`,
      error: 'Failed to set zero',
    });
    setIsLoading(true);
    promise.finally(() => {
      setIsLoading(false);
    });
  }

  return <TooltipIconButton label="Zero XY" icon={<CircleOff />} shortcut="z" onClick={onClick} disabled={isLoading} />;
}

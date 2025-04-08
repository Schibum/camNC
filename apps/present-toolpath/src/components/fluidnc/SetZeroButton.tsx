import { setWorkspaceXYZero } from '@/lib/cnc-api';
import { useState } from 'react';
import { Button } from '../ui/button';
import { CircleOff } from 'lucide-react';
import { LoadingSpinner } from '../ui/loading-spinner';
import { useStore } from '@/store';

export function SetZeroButton() {
  const [isLoading, setIsLoading] = useState(false);
  const toolpathOffset = useStore(s => s.toolpathOffset);

  function onClick() {
    setIsLoading(true);
    console.log('setting zero to', toolpathOffset);
    setWorkspaceXYZero(toolpathOffset.x, toolpathOffset.y).then(() => {
      setTimeout(() => {
        setIsLoading(false);
      }, 1000);
    });
  }
  return (
    <Button onClick={onClick} disabled={isLoading}>
      {isLoading ? <LoadingSpinner /> : <CircleOff />}
      Zero XY
    </Button>
  );
}

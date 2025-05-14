import { useCncApi, useStore } from '@/store';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { CircleOff } from 'lucide-react';
import { useState } from 'react';

export function SetZeroButton() {
  const [isLoading, setIsLoading] = useState(false);
  const toolpathOffset = useStore(s => s.toolpathOffset);
  const cncApi = useCncApi();

  function onClick() {
    setIsLoading(true);
    console.log('setting zero to', toolpathOffset);
    cncApi?.setWorkspaceXYZero(toolpathOffset.x, toolpathOffset.y).then(() => {
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

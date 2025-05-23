import { useTimeout } from '@/hooks/useTimeout';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';

export function LoadingVideoOverlay() {
  const [slowWarning] = useTimeout(10_000);
  return (
    <div className="w-full h-full flex items-center justify-center select-none">
      <div className="flex flex-col items-center justify-center gap-4">
        <LoadingSpinner className="size-20" />
        <div className="text-gray-500 text-2xl">Loading Video...</div>
        <div className={`text-red-500 text-sm ${slowWarning ? '' : 'invisible'}`}>
          This is taking longer than expected. Something might be wrong with the video source.
        </div>
      </div>
    </div>
  );
}

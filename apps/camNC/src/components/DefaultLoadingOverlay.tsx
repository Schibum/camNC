import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';

// eslint-disable-next-line react-refresh/only-export-components
export function DefaultLoadingOverlay() {
  return (
    <div className="w-full h-dvh flex items-center justify-center">
      <div className="flex flex-col items-center justify-center gap-4">
        <LoadingSpinner className="size-10" />
        <div className="text-gray-500 text-xl">Loading...</div>
      </div>
    </div>
  );
}

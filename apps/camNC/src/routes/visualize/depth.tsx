import { PageHeader } from '@/components/page-header';
import { useStore } from '@/store/store';
import { DepthInspector } from '@/visualize/DepthInspector';
import { OpenFileButton } from '@/visualize/toolbar/VisualizeToolbar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/visualize/depth')({
  component: DepthInspectorPage,
});

function DepthInspectorPage() {
  const toolpath = useStore(s => s.toolpath);
  return (
    <div className="flex h-dvh w-full flex-col">
      <PageHeader title="Depth Inspector" className="border-b">
        <div className="flex items-center pl-2">
          <OpenFileButton />
        </div>
      </PageHeader>
      <div className="min-h-0 flex-1">
        {toolpath ? (
          <DepthInspector toolpath={toolpath} />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">No toolpath loaded. Open a gcode file to inspect its depths.</div>
        )}
      </div>
    </div>
  );
}

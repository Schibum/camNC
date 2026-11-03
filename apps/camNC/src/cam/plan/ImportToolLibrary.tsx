import type { LibraryTool } from '@wbcnc/cam';
import { Button } from '@wbcnc/ui/components/button';
import { CopyButton } from '@wbcnc/ui/components/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@wbcnc/ui/components/dialog';
import { FileUp } from 'lucide-react';
import { useState } from 'react';
import { kFusionLibraryPaths, readLibraryFile, type LibraryImport } from '../toolLibrary';

function pickFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.tools';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** "Import Fusion tool library…": where to find the file, then what was found in it. */
export function ImportToolLibrary({ onImport }: { onImport: (tools: LibraryTool[], source: string) => void }) {
  const [result, setResult] = useState<LibraryImport | null>(null);
  const choose = async () => {
    const file = await pickFile();
    if (!file) return;
    const r = await readLibraryFile(file);
    setResult(r);
    if (r.ok) onImport(r.tools, r.file);
  };
  return (
    <Dialog onOpenChange={open => !open && setResult(null)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="self-start">
          Import Fusion tool library…
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a Fusion tool library</DialogTitle>
          <DialogDescription>
            Your bits with their feeds, so you can pick them here. Only flat end mills are used for now.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm leading-relaxed">
          <li>
            <span className="font-medium">Export it from Fusion (easiest):</span> Manufacture › Tool Library, right-click your library ›
            Export…, save the file (.tools or .json) and choose it below.
          </li>
          <li>
            <span className="font-medium">Or choose Fusion’s own file:</span>
            <span className="mt-1 flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs">
              <span className="min-w-0 flex-1 break-all">{kFusionLibraryPaths.mac}</span>
              <CopyButton value={kFusionLibraryPaths.mac} aria-label="Copy the path" />
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              The Library folder is hidden in the Mac file picker: press ⌘⇧G, paste the path and press Return. On Windows:{' '}
              <span className="font-mono">{kFusionLibraryPaths.windows}</span>
            </span>
          </li>
        </ol>
        <Button onClick={() => void choose()} className="self-start">
          <FileUp /> Choose file…
        </Button>
        {result && (
          <div
            role="status"
            className={
              result.ok ? 'rounded-md bg-emerald-500/10 p-3 text-sm' : 'rounded-md bg-destructive/10 p-3 text-sm text-destructive'
            }>
            {result.ok ? (
              <>
                <p className="font-medium">
                  {result.tools.length} flat end {result.tools.length === 1 ? 'mill' : 'mills'} from {result.file}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{result.tools.map(t => `⌀${t.diameter} ${t.name}`).join(' · ')}</p>
                {Object.keys(result.skipped).length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Skipped:{' '}
                    {Object.entries(result.skipped)
                      .map(([type, n]) => `${n} ${type}`)
                      .join(', ')}
                    .
                  </p>
                )}
              </>
            ) : (
              result.error
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

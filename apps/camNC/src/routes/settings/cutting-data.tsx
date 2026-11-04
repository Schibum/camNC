import { PageHeader } from '@/components/page-header';
import { bitKey, kCuttingLabels, useCuttingData, type CuttingField } from '@/cam/cuttingData';
import { CuttingDataEditor } from '@/cam/plan/CuttingDataEditor';
import { ImportToolLibrary } from '@/cam/plan/ImportToolLibrary';
import { kDefaultBit, type MaterialKey } from '@/cam/planSettings';
import { useToolLibrary } from '@/cam/toolLibrary';
import { createFileRoute } from '@tanstack/react-router';
import type { LibraryTool } from '@wbcnc/cam';
import { MATERIALS } from '@wbcnc/cam/settings';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/settings/cutting-data')({
  component: CuttingDataPage,
});

const materials = Object.keys(MATERIALS) as MaterialKey[];

/** Cutting data per bit + material, for every CAM job on this device: what's saved, and an editor for any pair. */
function CuttingDataPage() {
  const importLibrary = useToolLibrary(s => s.importLibrary);
  const stored = useToolLibrary(s => s.bits);
  const saved = useCuttingData(s => s.saved);
  const reset = useCuttingData(s => s.reset);
  const bits = [kDefaultBit, ...stored.filter(t => bitKey(t) !== bitKey(kDefaultBit))];
  const [bit, setBit] = useState<LibraryTool>(kDefaultBit);
  const [material, setMaterial] = useState<MaterialKey>('oak');
  const entries = Object.entries(saved).map(([key, values]) => {
    const [k, m] = key.split('@');
    const entry: { key: string; bit?: LibraryTool; material: MaterialKey; values: typeof values } = {
      key,
      bit: bits.find(x => bitKey(x) === k),
      material: m as MaterialKey,
      values,
    };
    return entry;
  });

  return (
    <div className="h-full w-full">
      <PageHeader title="Cutting data" />
      <div className="flex flex-row justify-center p-1">
        <div className="flex max-w-xl flex-1 flex-col gap-4 pb-8">
          <Card>
            <CardHeader>
              <CardTitle>Bit and material</CardTitle>
              <CardDescription>
                Feeds, stepdown and stepover per bit and material, used by every CAM job. A value you don’t set comes from your tool
                library, or from a safe default for the material.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cd-bit">Bit</Label>
                  <Select value={bitKey(bit)} onValueChange={k => setBit(bits.find(b => bitKey(b) === k)!)}>
                    <SelectTrigger id="cd-bit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {bits.map(b => (
                        <SelectItem key={bitKey(b)} value={bitKey(b)}>
                          ⌀ {b.diameter} · {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cd-material">Material</Label>
                  <Select value={material} onValueChange={m => setMaterial(m as MaterialKey)}>
                    <SelectTrigger id="cd-material" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {materials.map(m => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <CuttingDataEditor key={`${bitKey(bit)}@${material}`} bit={bit} material={material} />
              <ImportToolLibrary onImport={importLibrary} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Saved</CardTitle>
              <CardDescription>{entries.length ? 'Values you saved, by bit and material.' : 'Nothing saved yet.'}</CardDescription>
            </CardHeader>
            {entries.length > 0 && (
              <CardContent>
                <ul className="flex flex-col divide-y text-[13px]" aria-label="Saved cutting data">
                  {entries.map(e => (
                    <li key={e.key} className="flex items-center gap-3 py-2">
                      <button
                        className="flex grow flex-col text-left hover:underline"
                        disabled={!e.bit}
                        onClick={() => {
                          setBit(e.bit!);
                          setMaterial(e.material);
                        }}>
                        <span className="font-medium">
                          {e.bit ? `⌀ ${e.bit.diameter} · ${e.bit.name}` : 'A bit no longer in the library'} · {e.material}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {(Object.entries(e.values) as [CuttingField, number][])
                            .map(([f, v]) => `${kCuttingLabels[f].label} ${v}`)
                            .join(' · ')}
                        </span>
                      </button>
                      <Button size="icon" variant="ghost" aria-label={`Forget the saved values for ${e.key}`} onClick={() => reset(e.key)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

import { useStore } from '@/store';
import { NumberInputWithLabel } from '@wbcnc/ui/components/NumberInputWithLabel';
import { Button } from '@wbcnc/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@wbcnc/ui/components/dialog';
import { Settings2 } from 'lucide-react';

export function MachineBoundsInput() {
  const bounds = useStore(state => state.cameraConfig.machineBounds);
  const setters = useStore(state => state.machineBoundsSetters);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 className="mr-2" />
          Useable Machine Space
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Useable Machine Space</DialogTitle>
          <DialogDescription>Pulloff distances and max limits</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 @xs:grid-cols-2 gap-2">
          <NumberInputWithLabel label="xmin" value={bounds.min.x} onValueChange={value => value && setters.setXMin(value)} />
          <NumberInputWithLabel label="xmax" value={bounds.max.x} onValueChange={value => value && setters.setXMax(value)} />

          <NumberInputWithLabel label="ymin" value={bounds.min.y} onValueChange={value => value && setters.setYMin(value)} />
          <NumberInputWithLabel label="ymax" value={bounds.max.y} onValueChange={value => value && setters.setYMax(value)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

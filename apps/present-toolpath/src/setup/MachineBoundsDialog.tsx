import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@wbcnc/ui/components/dialog';
import { useStore } from '@/store';
import { InputWithLabel } from '@wbcnc/ui/components/InputWithLabel';
import { Button } from '@wbcnc/ui/components/button';
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
          <InputWithLabel label="xmin" value={bounds.min.x} onChange={value => setters.setXMin(value)} />
          <InputWithLabel label="xmax" value={bounds.max.x} onChange={value => setters.setXMax(value)} />

          <InputWithLabel label="ymin" value={bounds.min.y} onChange={value => setters.setYMin(value)} />
          <InputWithLabel label="ymax" value={bounds.max.y} onChange={value => setters.setYMax(value)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

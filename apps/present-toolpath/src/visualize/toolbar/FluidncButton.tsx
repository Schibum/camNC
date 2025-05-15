import { getFluidNcClient } from '@/fluidnc-hooks';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@wbcnc/ui/components/dialog';
import { Link2, Link2Off } from 'lucide-react';
import { useState } from 'react';
import { FluidNcUrlCopyInput } from './FluidNcUrlCopyInput';
import { TooltipIconButton } from './TooltipIconButton';

export function FluidncButton() {
  'use no memo';
  const client = getFluidNcClient();
  const [open, setOpen] = useState(false);
  const tooltip = 'FluidNC ' + (client.isConnected.value ? '(Connected)' : '(Not Connected)');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <TooltipIconButton label={tooltip} icon={client.isConnected.value ? <Link2 /> : <Link2Off />} onClick={() => {}} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>FluidNC Integration</DialogTitle>
          <DialogDescription>Add under Settings → Interface → Additional Content as Panel with type Extension</DialogDescription>
        </DialogHeader>
        <FluidNcUrlCopyInput />
      </DialogContent>
    </Dialog>
  );
}

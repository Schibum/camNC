import { useSetShowStillFrame, useShowStillFrame, useStore } from '@/store';
import { Button } from '@wbcnc/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@wbcnc/ui/components/dialog';
import { allowCmdOnMac, Kbd } from '@wbcnc/ui/components/kbd';
import { NumberInputWithLabel } from '@wbcnc/ui/components/NumberInputWithLabel';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { Diameter, FolderOpen, MonitorPause, MonitorPlay, PencilRuler } from 'lucide-react';
import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { CommandsMenu } from './CommandsMenu';

function TooltipIconButton({
  label,
  icon,
  shortcut,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
}) {
  shortcut = allowCmdOnMac(shortcut ?? '');
  useHotkeys(shortcut, onClick, { preventDefault: true });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button onClick={onClick} aria-label={label} variant="ghost">
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex items-center gap-2">
          {label} <Kbd shortcut={shortcut} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function PlayPauseButton() {
  const showStillFrame = useShowStillFrame();
  const setShowStillFrame = useSetShowStillFrame();
  function toggleShowStillFrame() {
    setShowStillFrame(!showStillFrame);
  }
  const label = showStillFrame ? 'Play Video' : 'Pause Video';
  return (
    <TooltipIconButton
      label={label}
      icon={showStillFrame ? <MonitorPlay /> : <MonitorPause />}
      shortcut="space"
      onClick={toggleShowStillFrame}
    />
  );
}

function OpenFileButton() {
  const updateToolpath = useStore(s => s.updateToolpath);

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const contents = e.target?.result;
      // Process the GCode content
      updateToolpath(contents as string);
    };
    reader.readAsText(file, 'utf-8');
  };

  function chooseFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gcode, .nc';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        handleFileUpload(file);
      }
    };
    input.click();
  }
  return <TooltipIconButton label="Open File" icon={<FolderOpen />} shortcut="o" onClick={chooseFile} />;
}

function ToolDiameterButton() {
  const toolDiameter = useStore(s => s.toolDiameter);
  return (
    <TooltipIconButton
      label="Tool Diameter"
      icon={
        <>
          <Diameter /> <span className="text-xs text-muted-foreground">{toolDiameter}mm</span>
        </>
      }
      shortcut="t"
      onClick={() => {}}
    />
  );
}

function StockHeightDialogButton() {
  const stockHeight = useStore(s => s.stockHeight);
  const [open, setOpen] = useState(false);
  const setStockHeight = useStore(s => s.setStockHeight);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <StockHeightButton onClick={() => setOpen(true)} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Stock Height</DialogTitle>
            <DialogDescription>
              Adjust the height of the stock. This accounts for camera perspective on the top of the stock.
              <br />
              Note: only objects at the given height will have video pixels matching the machine coordinates.
            </DialogDescription>
          </DialogHeader>

          <NumberInputWithLabel
            decimalScale={2}
            min={0}
            label="Stock Height"
            value={stockHeight}
            suffix="mm"
            step={0.1}
            onValueChange={value => value && setStockHeight(value)}
          />
          <DialogFooter>
            <Button type="button">OK</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StockHeightButton({ onClick }: { onClick: () => void }) {
  const stockHeight = useStore(s => s.stockHeight);
  return (
    <TooltipIconButton
      onClick={onClick}
      label="Stock Height"
      icon={
        <>
          <PencilRuler /> <span className="text-xs text-muted-foreground">{stockHeight}mm</span>
        </>
      }
      shortcut="h"
    />
  );
}

export function VisualizeToolbar() {
  return (
    <div className="flex gap-2 items-center">
      <OpenFileButton />
      <PlayPauseButton />
      <ToolDiameterButton />
      <StockHeightDialogButton />
      <CommandsMenu />
    </div>
  );
}

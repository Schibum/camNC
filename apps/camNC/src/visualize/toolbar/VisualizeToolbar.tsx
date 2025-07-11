import {
  useHasToolpath,
  useSetShowStillFrame,
  useSetToolpathOpacity,
  useShowStillFrame,
  useStore,
  useToolpathOpacity,
} from '@/store/store';
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
import { Label } from '@wbcnc/ui/components/label';
import { NumberInputWithLabel } from '@wbcnc/ui/components/NumberInputWithLabel';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { Slider } from '@wbcnc/ui/components/slider';
import { Diameter, FolderOpen, Info, MonitorPause, MonitorPlay, Palette, PencilRuler } from 'lucide-react';
import { useState } from 'react';
import { BoundsInfo } from '../BoundsInfo';
import { ZDepthLegend } from '../ZDepthLegend';
import { DepthBlendButton } from './DepthBlendButton';
import { FluidncButton } from './FluidncButton';
import { TooltipIconButton } from './TooltipIconButton';

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
  return <TooltipIconButton label="Open gcode File" icon={<FolderOpen />} shortcut="o" onClick={chooseFile} />;
}

function ToolDiameterButton({ onClick }: { onClick: () => void }) {
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
      onClick={onClick}
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
              Set the stock material height to compensate for camera perspective effects.
              <br />
              Important: Machine coordinates will only align perfectly with video pixels for objects at this specific height.
            </DialogDescription>
          </DialogHeader>

          <NumberInputWithLabel
            decimalScale={2}
            min={0}
            label="Stock Height"
            value={stockHeight}
            suffix="mm"
            step={0.1}
            onValueChange={value => value !== undefined && setStockHeight(value)}
          />
          <DialogFooter>
            <Button type="submit">OK</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToolDiameterDialogButton() {
  const toolDiameter = useStore(s => s.toolDiameter);
  const [open, setOpen] = useState(false);
  const setToolDiameter = useStore(s => s.setToolDiameter);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <ToolDiameterButton onClick={() => setOpen(true)} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Tool Diameter</DialogTitle>
            <DialogDescription>Adjust the diameter of the tool.</DialogDescription>
          </DialogHeader>
          <NumberInputWithLabel
            decimalScale={2}
            min={0}
            label="Tool Diameter"
            value={toolDiameter}
            suffix="mm"
            step={0.1}
            onValueChange={value => value && setToolDiameter(value)}
          />
          <DialogFooter>
            <Button type="submit">OK</Button>
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
      className={stockHeight === 0 ? 'bg-warning' : ''}
      icon={
        <>
          <PencilRuler /> <span className="text-xs text-muted-foreground">{stockHeight}mm</span>
        </>
      }
      shortcut="h"
    />
  );
}

function ColorLegendButton() {
  const [open, setOpen] = useState(false);
  const hasToolpath = useHasToolpath();
  const opacity = useToolpathOpacity();
  const setOpacity = useSetToolpathOpacity();
  if (!hasToolpath) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <TooltipIconButton label="Color Legend" icon={<Palette />} shortcut="c" onClick={() => setOpen(true)} />
        </div>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-col gap-4">
          <ZDepthLegend />
          <div className="grid w-full items-center gap-1.5">
            <Label htmlFor="opacity-slider">Opacity</Label>
            <Slider
              id="opacity-slider"
              min={0.1}
              max={1}
              step={0.01}
              value={[opacity]}
              onValueChange={(v: number | number[]) => setOpacity(Array.isArray(v) ? v[0] : v)}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BoundsInfoButton() {
  const hasToolpath = useHasToolpath();
  const [open, setOpen] = useState(false);
  if (!hasToolpath) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <TooltipIconButton label="Bounds Info" icon={<Info />} shortcut="i" onClick={() => setOpen(true)} />
        </div>
      </PopoverTrigger>
      <PopoverContent>
        <BoundsInfo />
      </PopoverContent>
    </Popover>
  );
}

export function VisualizeToolbar() {
  return (
    <div className="flex gap-0 items-center pl-2">
      <OpenFileButton />
      <PlayPauseButton />
      <DepthBlendButton />
      <ToolDiameterDialogButton />
      <StockHeightDialogButton />
      <ColorLegendButton />
      <BoundsInfoButton />
      <FluidncButton />
      {/* <CommandsMenu /> */}
    </div>
  );
}

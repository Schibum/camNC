import { useSetShowStillFrame, useShowStillFrame, useStore } from '@/store';
import { Button } from '@wbcnc/ui/components/button';
import { allowCmdOnMac, Kbd } from '@wbcnc/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { Diameter, FolderOpen, MonitorPause, MonitorPlay, PencilRuler } from 'lucide-react';
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
  useHotkeys(shortcut, onClick);

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
  return <TooltipIconButton label="Open File" icon={<FolderOpen />} shortcut="ctrl+shift+o" onClick={chooseFile} />;
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
      shortcut="ctrl+shift+t"
      onClick={() => {}}
    />
  );
}

function StockHeightButton() {
  const stockHeight = useStore(s => s.stockHeight);
  return (
    <TooltipIconButton
      label="Stock Height"
      icon={
        <>
          <PencilRuler /> <span className="text-xs text-muted-foreground">{stockHeight}mm</span>
        </>
      }
      shortcut="ctrl+shift+h"
      onClick={() => {}}
    />
  );
}

export function VisualizeToolbar() {
  return (
    <div className="flex gap-2 items-center">
      <OpenFileButton />
      <PlayPauseButton />
      <ToolDiameterButton />
      <StockHeightButton />
      <CommandsMenu />
    </div>
  );
}

import { useSetShowStillFrame, useShowStillFrame } from '@/store/store';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@wbcnc/ui/components/command';
import { allowCmdOnMac, Kbd } from '@wbcnc/ui/components/kbd';
import { Calculator, Pause, Play, Smile } from 'lucide-react';
import React from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

export function CommandsMenu() {
  const [open, setOpen] = React.useState(false);
  const shortcut = allowCmdOnMac('ctrl+j');
  useHotkeys(shortcut, () => setOpen(true));
  const showStillFrame = useShowStillFrame();
  const setShowStillFrame = useSetShowStillFrame();
  function toggleShowStillFrame() {
    setShowStillFrame(!showStillFrame);
    setOpen(false);
  }

  return (
    <>
      <p className="text-sm text-muted-foreground ml-1">
        Press <Kbd shortcut={shortcut} />
      </p>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            {!showStillFrame ? (
              <CommandItem onSelect={toggleShowStillFrame}>
                <Pause />
                <span>Pause Video</span>
                <CommandShortcut>Space</CommandShortcut>
              </CommandItem>
            ) : (
              <CommandItem onSelect={toggleShowStillFrame}>
                <Play />
                <span>Play Video</span>
                <CommandShortcut>Space</CommandShortcut>
              </CommandItem>
            )}
            <CommandItem>
              <Smile />
              <span>Search Emoji</span>
            </CommandItem>
            <CommandItem>
              <Calculator />
              <span>Calculator</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
        </CommandList>
      </CommandDialog>
    </>
  );
}

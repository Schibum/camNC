import { useSetShowStillFrame, useShowStillFrame } from '@/store';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@wbcnc/ui/components/command';
import { Kbd } from '@wbcnc/ui/components/kbd';
import { Calculator, Pause, Play, Smile } from 'lucide-react';
import React from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

export function CommandsMenu() {
  const [open, setOpen] = React.useState(false)
  useHotkeys('ctrl+j, meta+j', () => setOpen(true))
  const showStillFrame = useShowStillFrame()
  const setShowStillFrame = useSetShowStillFrame()

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Press <Kbd modifiers="ctrl" k="j" />
      </p>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            {showStillFrame ? (
              <CommandItem onSelect={() => setShowStillFrame(false)}>
                <Pause />
                <span>Pause Video</span>
              </CommandItem>
            ) : (
              <CommandItem onSelect={() => setShowStillFrame(true)}>
                <Play />
                <span>Play Video</span>
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
  )
}

function getModifierLabel(modifier: string) {
  const isMac = navigator.userAgent.includes('Mac');
  if (modifier === 'ctrl') {
    return isMac ? '⌘' : 'Ctrl';
  } else if (modifier === 'shift') {
    return isMac ? '⇧' : 'Shift';
  } else if (modifier === 'alt') {
    return isMac ? '⌥' : 'Alt';
  } else if (modifier === 'control') {
    return isMac ? '⌃' : 'Ctrl';
  }
  return modifier;
}

export function Kbd({ modifiers, k }: { modifiers: string, k: string }) {
  return (
    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
      <span className="text-xs"> {modifiers.split(' ').map(getModifierLabel).join(' ')}</span>
      {k.toUpperCase()}
    </kbd>
  );
}

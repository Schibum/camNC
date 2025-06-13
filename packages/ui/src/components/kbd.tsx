import { cn } from "../lib/utils.js";

export function shouldUseMacShortcuts() {
  return !!navigator.userAgent.includes("Mac");
}

export function allowCmdOnMac(shortcut: string) {
  if (shouldUseMacShortcuts()) {
    return shortcut.replace("ctrl", "meta");
  }
  return shortcut;
}

function getModifierLabel(modifier: string) {
  const isMac = shouldUseMacShortcuts();
  if (modifier === "meta") {
    return isMac ? "⌘" : "Meta";
  } else if (modifier === "shift") {
    return isMac ? "⇧" : "Shift";
  } else if (modifier === "alt") {
    return isMac ? "⌥" : "Alt";
  } else if (modifier === "ctrl") {
    return isMac ? "⌃" : "Ctrl";
  }
  return modifier;
}

/**
 * A component that displays a keyboard shortcut
 * @param shortcut - The shortcut to display as a string, e.g. "ctrl+o, ctrl+shift+o"
 * @returns A keyboard shortcut component
 */
export function Kbd({
  shortcut,
  className,
  ...props
}: { shortcut: string } & React.HTMLAttributes<HTMLElement>) {
  const items = shortcut.split("+");
  if (items.length < 1) {
    return null;
  }
  const modifiers = items.slice(0, -1);
  const k = items[items.length - 1];
  if (!k) {
    return null;
  }
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100",
        className,
      )}
      {...props}
    >
      <span className="text-xs">
        {" "}
        {modifiers.map(getModifierLabel).join(" ")}
      </span>
      {k.toUpperCase()}
    </kbd>
  );
}

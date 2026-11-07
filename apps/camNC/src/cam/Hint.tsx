import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { cloneElement, useId, useRef, useState, type ReactElement } from 'react';

type Side = 'top' | 'right' | 'bottom' | 'left';

/** Gap kept to the screen edge, in px. */
const kEdgeGap = 8;
/** The tooltip's widest, in px: the 18rem of its class at the default font size. */
const kMaxWidth = 288;

/** The tooltip only flips left to right by itself: with room on neither side it goes above the control instead. */
function sideWithRoom(side: Side, trigger: Element | null): Side {
  if (!trigger || side === 'top' || side === 'bottom') return side;
  const { left, right } = trigger.getBoundingClientRect();
  const room = Math.max(left, document.documentElement.clientWidth - right);
  return room >= kMaxWidth + 2 * kEdgeGap ? side : 'top';
}

/**
 * A short explanation of a control: a tooltip on hover and on keyboard focus, and the control's accessible description
 * (a hidden text it points to with `aria-describedby`), so screen readers read it too.
 *
 * - Default: `children` is the control (a button, a trigger); it becomes the tooltip trigger and gets the description.
 * - `wrap`: the control sits in a span that is the trigger, so a disabled button still shows its tooltip.
 * - `id`: the control is somewhere inside `children` (a field with its label, a radio in its label); it points to the
 *   description itself with `aria-describedby={id}`, and `children` only triggers the tooltip (focus inside opens it).
 */
export function Hint({
  text,
  children,
  side = 'top',
  wrap = false,
  id,
}: {
  text: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: Side;
  wrap?: boolean;
  id?: string;
}) {
  const ownId = useId();
  const descId = id ?? ownId;
  const control = id ? children : cloneElement(children, { 'aria-describedby': descId });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [openSide, setOpenSide] = useState(side);
  return (
    <Tooltip onOpenChange={open => open && setOpenSide(sideWithRoom(side, triggerRef.current))}>
      <TooltipTrigger ref={triggerRef} asChild>
        {wrap ? <span className="inline-flex">{control}</span> : control}
      </TooltipTrigger>
      <TooltipContent
        side={openSide}
        collisionPadding={kEdgeGap}
        className="max-w-[min(18rem,var(--radix-tooltip-content-available-width))]">
        {text}
      </TooltipContent>
      {/* Hidden, so it is no part of any accessible name or live region; aria-describedby still reads hidden text. */}
      <span id={descId} hidden>
        {text}
      </span>
    </Tooltip>
  );
}

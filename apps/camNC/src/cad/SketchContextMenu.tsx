import { Fragment, useRef } from 'react';
import { Focus, Maximize, MousePointer2, Pencil, Ruler, Trash2 } from 'lucide-react';
import type { CadSketch } from '@wbcnc/cad';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { sketchContextItems, type SketchContext, type SketchContextAction } from './sketchContext';
import './SketchContextMenu.css';

export interface SketchContextMenuProps {
  sketch: CadSketch;
  context: SketchContext | null;
  busy?: boolean;
  onClose: () => void;
  onAction: (action: SketchContextAction, context: SketchContext) => void;
  onReturnToCanvas: () => void;
}
const icons = {
  'delete-entities': Trash2,
  'delete-dimensions': Trash2,
  'edit-dimension': Pencil,
  'toggle-driven': Ruler,
  clear: MousePointer2,
  fit: Maximize,
  'fit-selection': Focus,
};

/** A collision-aware portal keeps menu navigation and focus ownership out of the sketch gesture handlers. */
export function SketchContextMenu({ sketch, context, busy = false, onClose, onAction, onReturnToCanvas }: SketchContextMenuProps) {
  const restoreCanvasFocus = useRef(true);
  if (!context) return null;
  const items = sketchContextItems(sketch, context, busy);
  const name =
    context.target.kind === 'dimension'
      ? 'Sketch dimension menu'
      : context.target.kind === 'entity'
        ? 'Sketch geometry menu'
        : 'Sketch menu';
  const activate = (action: SketchContextAction) => {
    // The dimension editor takes focus itself; menu dismissal must not steal that new input's focus.
    restoreCanvasFocus.current = action !== 'edit-dimension';
    onClose();
    onAction(action, context);
  };
  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={open => {
        if (!open) onClose();
      }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={name}
          className="cad-context-anchor"
          style={{ left: context.position.x, top: context.position.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="cad-context-menu"
        aria-label={name}
        align="start"
        sideOffset={0}
        collisionPadding={8}
        loop
        onKeyDown={event => event.stopPropagation()}
        onContextMenu={event => event.preventDefault()}
        onEscapeKeyDown={event => {
          restoreCanvasFocus.current = true;
          event.stopPropagation();
        }}
        onInteractOutside={() => {
          restoreCanvasFocus.current = false;
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (restoreCanvasFocus.current) onReturnToCanvas();
          restoreCanvasFocus.current = true;
        }}>
        {items.map(item => {
          const Icon = item.action === 'construction' ? null : icons[item.action];
          const content = (
            <>
              {Icon && <Icon aria-hidden="true" />}
              <span>{item.label}</span>
              {item.shortcut && <DropdownMenuShortcut aria-hidden="true">{item.shortcut}</DropdownMenuShortcut>}
            </>
          );
          return (
            <Fragment key={item.action}>
              {item.separatorBefore && <DropdownMenuSeparator />}
              {item.checked !== undefined ? (
                <DropdownMenuCheckboxItem
                  className="cad-context-item"
                  checked={item.checked}
                  disabled={item.disabled}
                  onSelect={() => activate(item.action)}>
                  {content}
                </DropdownMenuCheckboxItem>
              ) : (
                <DropdownMenuItem className="cad-context-item" disabled={item.disabled} onSelect={() => activate(item.action)}>
                  {content}
                </DropdownMenuItem>
              )}
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import type { ConstraintCommandTool } from './constraintCommands';
import {
  sketchToolFamilies,
  sketchToolGroups,
  sketchToolLabel,
  sketchToolSection,
  type SketchTool,
  type SketchToolDefinition,
} from './sketchTools';

type Glyph = SketchTool | ConstraintCommandTool | 'construction' | 'constraints' | 'fix' | 'undo' | 'redo' | 'cancel' | 'finish';
type ToolGroupId = (typeof sketchToolGroups)[number]['id'] | (typeof sketchToolFamilies)[number]['id'];
const rememberedTools: Partial<Record<ToolGroupId, SketchTool>> = {};

export function SketchToolGlyph({ kind }: { kind: Glyph }) {
  let shape: ReactNode;
  switch (kind) {
    case 'select':
      shape = <path d="m5 3 14 10-7 1-4 7z" />;
      break;
    case 'line':
      shape = (
        <>
          <path d="M5 19 19 5" />
          <circle cx="5" cy="19" r="1" fill="currentColor" />
          <circle cx="19" cy="5" r="1" fill="currentColor" />
        </>
      );
      break;
    case 'rectangle':
      shape = <rect x="4" y="6" width="16" height="12" />;
      break;
    case 'centerRectangle':
      shape = (
        <>
          <rect x="4" y="6" width="16" height="12" />
          <path d="M4 6 20 18M4 18 20 6" strokeDasharray="2 2" />
          <path d="M10 12h4m-2-2v4" />
        </>
      );
      break;
    case 'circle':
      shape = (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r=".8" fill="currentColor" />
        </>
      );
      break;
    case 'arc':
      shape = (
        <>
          <path d="M4 18a8 8 0 0 1 16 0" />
          <circle cx="4" cy="18" r="1" fill="currentColor" />
          <circle cx="20" cy="18" r="1" fill="currentColor" />
        </>
      );
      break;
    case 'tangentArc':
      shape = (
        <>
          <path d="M3 19h7a10 10 0 0 0 10-10V4" />
          <path d="M8 16v6" strokeDasharray="1 2" />
        </>
      );
      break;
    case 'point':
      shape = (
        <>
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <path d="M12 4v3m0 10v3M4 12h3m10 0h3" />
        </>
      );
      break;
    case 'curveControlPoint':
      shape = (
        <>
          <path d="M3 18C8-4 14 28 21 6" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <path d="M12 6v12m-6-6h12" />
        </>
      );
      break;
    case 'fillet':
      shape = (
        <>
          <path d="M4 4v10a6 6 0 0 0 6 6h10" />
          <path d="M4 20h16M4 4v16" strokeDasharray="2 3" />
        </>
      );
      break;
    case 'conic':
      shape = (
        <>
          <path d="M3 19Q12-9 21 19" />
          <path d="M3 19 12 4 21 19" strokeDasharray="2 3" />
          <circle cx="12" cy="4" r="1" fill="currentColor" />
        </>
      );
      break;
    case 'spline':
      shape = (
        <>
          <path d="M3 18C8-4 14 28 21 6" />
          <circle cx="3" cy="18" r="1" fill="currentColor" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
          <circle cx="21" cy="6" r="1" fill="currentColor" />
        </>
      );
      break;
    case 'bezier':
      shape = (
        <>
          <path d="M3 18C5-4 19 28 21 6" />
          <path d="M3 18 5 4 19 20 21 6" strokeDasharray="2 2" />
          <rect x="4" y="3" width="2" height="2" />
          <rect x="18" y="19" width="2" height="2" />
        </>
      );
      break;
    case 'trim':
      shape = (
        <>
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="m8 8 12 12M8 16 20 4m-8 8h1" />
        </>
      );
      break;
    case 'dimension':
      shape = (
        <>
          <path d="M4 4v16M20 4v16M4 12h16m-12-3-4 3 4 3m8-6 4 3-4 3" />
        </>
      );
      break;
    case 'extend':
      shape = (
        <>
          <path d="M3 17h9m0 0h8m-4-4 4 4-4 4M20 3v18" />
          <path d="M12 17V5" strokeDasharray="2 3" />
        </>
      );
      break;
    case 'offset':
      shape = (
        <>
          <path d="M3 18V4h14M8 21V9h13" />
          <path d="m10 15 4-4m-4 1v3h3" />
        </>
      );
      break;
    case 'mirror':
      shape = (
        <>
          <path d="M12 2v20" strokeDasharray="2 3" />
          <path d="M3 7v10l5-5zm18 0v10l-5-5z" />
        </>
      );
      break;
    case 'construction':
      shape = <path d="M4 19 19 4" strokeDasharray="4 3" />;
      break;
    case 'horizontal':
      shape = <path d="M4 12h16m-16-3v6m16-6v6" />;
      break;
    case 'vertical':
      shape = <path d="M12 4v16m-3-16h6m-6 16h6" />;
      break;
    case 'coincident':
      shape = (
        <>
          <circle cx="9" cy="12" r="5" />
          <circle cx="15" cy="12" r="5" />
        </>
      );
      break;
    case 'midpoint':
      shape = (
        <>
          <path d="M3 12h18M3 9v6m18-6v6" />
          <path d="m12 8 4 4-4 4-4-4z" />
        </>
      );
      break;
    case 'parallel':
      shape = <path d="m6 20 6-16m0 16 6-16" />;
      break;
    case 'perpendicular':
      shape = <path d="M4 18h16M12 18V4" />;
      break;
    case 'equal':
      shape = <path d="M5 8h14M5 16h14" />;
      break;
    case 'tangent':
      shape = (
        <>
          <circle cx="12" cy="10" r="6" />
          <path d="M3 16h18" />
        </>
      );
      break;
    case 'fix':
      shape = (
        <>
          <rect x="6" y="10" width="12" height="10" rx="1" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      );
      break;
    case 'constraints':
      shape = (
        <>
          <path d="M4 18h16M8 18V5m6 1h6m-6 4h6" />
          <circle cx="8" cy="18" r="2" />
        </>
      );
      break;
    case 'undo':
      shape = <path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6v3" />;
      break;
    case 'redo':
      shape = <path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0-6 6v3" />;
      break;
    case 'cancel':
      shape = <path d="m6 6 12 12M6 18 18 6" />;
      break;
    case 'finish':
      shape = <path d="m4 12 5 5L20 6" />;
      break;
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false">
      {shape}
    </svg>
  );
}

const constraints: { id: ConstraintCommandTool; label: string; key: string }[] = [
  { id: 'horizontal', label: 'Horizontal', key: 'H' },
  { id: 'vertical', label: 'Vertical', key: 'V' },
  { id: 'coincident', label: 'Coincident', key: 'I' },
  { id: 'midpoint', label: 'Midpoint', key: 'Shift+M' },
  { id: 'parallel', label: 'Parallel', key: 'B' },
  { id: 'perpendicular', label: 'Perpendicular', key: 'Shift+L' },
  { id: 'equal', label: 'Equal', key: 'E' },
  { id: 'tangent', label: 'Tangent', key: 'T' },
];

function ToolHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="cad-toolbar-tooltip">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function SketchToolbar({
  tools,
  tool,
  construction,
  constraintMode,
  busy,
  canUndo,
  canRedo,
  canFinish,
  onTool,
  onConstruction,
  onConstraint,
  onFix,
  onUndo,
  onRedo,
  onCancel,
  onFinish,
  onReturnToCanvas,
}: {
  tools: readonly SketchToolDefinition[];
  tool: SketchTool;
  construction: boolean;
  constraintMode: ConstraintCommandTool | null;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canFinish: boolean;
  onTool: (tool: SketchTool) => void;
  onConstruction: () => void;
  onConstraint: (tool: ConstraintCommandTool) => void;
  onFix: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onFinish: () => void;
  onReturnToCanvas: () => void;
}) {
  const toolbar = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  const [preferred, setPreferred] = useState(() => ({ ...rememberedTools }));
  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    // Changing the actual menu structure avoids duplicate tab stops and stale portals on resize.
    const familyWidth =
      640 +
      (tools.some(tool => tool.id === 'offset') ? 32 : 0) +
      (tools.some(tool => tool.id === 'mirror') ? 32 : 0) +
      (tools.some(tool => tool.id === 'extend') ? 16 : 0);
    const measure = () => setCompact(element.clientWidth < familyWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tools]);
  useEffect(() => {
    const groups = [...sketchToolGroups, ...sketchToolFamilies].filter(group => (group.tools as readonly string[]).includes(tool));
    if (!groups.length) return;
    for (const group of groups) rememberedTools[group.id] = tool;
    setPreferred(previous =>
      groups.every(group => previous[group.id] === tool)
        ? previous
        : { ...previous, ...Object.fromEntries(groups.map(group => [group.id, tool])) }
    );
  }, [tool]);
  const toolButton = (item: SketchToolDefinition) => (
    <ToolHint label={sketchToolLabel(item)}>
      <button
        type="button"
        className="cad-icon-button"
        aria-label={sketchToolLabel(item)}
        aria-pressed={tool === item.id && !constraintMode}
        onClick={() => onTool(item.id)}>
        <SketchToolGlyph kind={item.id} />
      </button>
    </ToolHint>
  );
  return (
    <header
      ref={toolbar}
      className="cad-toolbar"
      role="toolbar"
      aria-label="Sketch toolbar"
      data-toolbar-layout={compact ? 'compact' : 'families'}>
      <div className="cad-tool-group cad-drawing-tools" aria-label="Sketch tools" role="group" inert={busy}>
        {tools.map(item => {
          const group = (compact ? sketchToolGroups : sketchToolFamilies).find(group =>
            (group.tools as readonly string[]).includes(item.id)
          );
          if (!group)
            return (
              <div key={item.id} className="cad-single-tool">
                {toolButton(item)}
              </div>
            );
          const choices = tools.filter(candidate => (group.tools as readonly string[]).includes(candidate.id));
          if (choices[0]?.id !== item.id) return null;
          const chosen =
            choices.find(choice => choice.id === tool) ?? choices.find(choice => choice.id === preferred[group.id]) ?? choices[0]!;
          return (
            <div key={group.id} className="cad-tool-family" data-tool-group={group.id}>
              {toolButton(chosen)}
              {choices.length > 1 && (
                <DropdownMenu modal={false}>
                  <ToolHint label={group.label}>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="cad-icon-button cad-tool-picker" aria-label={group.label}>
                        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                          <path d="m2 4 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
                        </svg>
                      </button>
                    </DropdownMenuTrigger>
                  </ToolHint>
                  <DropdownMenuContent
                    align="start"
                    className="cad-tool-menu"
                    onKeyDown={event => event.stopPropagation()}
                    onEscapeKeyDown={event => event.stopPropagation()}
                    onCloseAutoFocus={event => {
                      event.preventDefault();
                      onReturnToCanvas();
                    }}>
                    {choices.map((choice, index) => (
                      <div key={choice.id}>
                        {index > 0 && sketchToolSection(choices[index - 1]!.id) !== sketchToolSection(choice.id) && (
                          <DropdownMenuSeparator />
                        )}
                        <DropdownMenuItem
                          aria-label={sketchToolLabel(choice)}
                          onSelect={() => {
                            rememberedTools[group.id] = choice.id;
                            setPreferred(previous => ({ ...previous, [group.id]: choice.id }));
                            onTool(choice.id);
                          }}>
                          <SketchToolGlyph kind={choice.id} />
                          <span>{choice.label}</span>
                          {choice.key && <DropdownMenuShortcut>{choice.key}</DropdownMenuShortcut>}
                        </DropdownMenuItem>
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
        <ToolHint label="Construction geometry (Q)">
          <button
            type="button"
            className="cad-icon-button"
            aria-label="Construction Q"
            aria-pressed={construction}
            onClick={onConstruction}>
            <SketchToolGlyph kind="construction" />
          </button>
        </ToolHint>
        <span className="cad-toolbar-divider" aria-hidden="true" />
        <DropdownMenu modal={false}>
          <ToolHint label={constraintMode ? `${constraints.find(c => c.id === constraintMode)?.label} constraint` : 'Constraints'}>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cad-icon-button" aria-label="Constraints" aria-pressed={!!constraintMode}>
                <SketchToolGlyph kind={constraintMode ?? 'constraints'} />
              </button>
            </DropdownMenuTrigger>
          </ToolHint>
          <DropdownMenuContent
            align="start"
            className="cad-constraint-menu"
            onKeyDown={event => event.stopPropagation()}
            onCloseAutoFocus={event => {
              event.preventDefault();
              onReturnToCanvas();
            }}
            onEscapeKeyDown={event => event.stopPropagation()}>
            {constraints.map(c => (
              <DropdownMenuItem key={c.id} onSelect={() => onConstraint(c.id)} aria-label={c.id}>
                <SketchToolGlyph kind={c.id} />
                <span>{c.label}</span>
                <DropdownMenuShortcut>{c.key}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onFix}>
              <SketchToolGlyph kind="fix" />
              <span>Fix / Unfix</span>
              <DropdownMenuShortcut>Shift+J</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="cad-tool-group cad-session-actions" aria-label="Sketch actions" role="group">
        <ToolHint label="Undo (Ctrl or Command Z)">
          <button
            type="button"
            className="cad-icon-button"
            aria-label="Undo (Ctrl or Command Z)"
            disabled={!canUndo || busy}
            onClick={onUndo}>
            <SketchToolGlyph kind="undo" />
          </button>
        </ToolHint>
        <ToolHint label="Redo (Ctrl or Command Shift Z)">
          <button
            type="button"
            className="cad-icon-button"
            aria-label="Redo (Ctrl or Command Shift Z)"
            disabled={!canRedo || busy}
            onClick={onRedo}>
            <SketchToolGlyph kind="redo" />
          </button>
        </ToolHint>
        <span className="cad-toolbar-divider" aria-hidden="true" />
        <ToolHint label="Cancel sketch">
          <button type="button" className="cad-icon-button cad-cancel" aria-label="Cancel" disabled={busy} onClick={onCancel}>
            <SketchToolGlyph kind="cancel" />
          </button>
        </ToolHint>
        <ToolHint label="Finish sketch">
          <button
            type="button"
            className="cad-icon-button cad-finish"
            aria-label="✓ Finish sketch"
            disabled={busy || !canFinish}
            onClick={onFinish}>
            <SketchToolGlyph kind="finish" />
          </button>
        </ToolHint>
      </div>
    </header>
  );
}

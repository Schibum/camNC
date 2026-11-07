import { useEffect, type CSSProperties, type RefObject } from 'react';
import type { ModificationWorkflow } from './modificationWorkflow';
import { CadUnitSuffix, CadValueInput } from './CadValueInput';

export function ModificationControls({
  state,
  inputRef,
  position,
  error,
  onText,
  onEdit,
  onAccept,
  onCancel,
  onMirrorPicking,
}: {
  state: ModificationWorkflow;
  inputRef: RefObject<HTMLInputElement | null>;
  position?: CSSProperties;
  error?: string;
  onText: (text: string) => void;
  onEdit: () => void;
  onAccept: () => void;
  onCancel: () => void;
  onMirrorPicking: (picking: 'entities' | 'axis') => void;
}) {
  const editing = state.phase === 'offset' && state.editing;
  const selectAll = state.phase === 'offset' && state.selectAll;
  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    if (selectAll) input?.select();
    else if (input) input.setSelectionRange(input.value.length, input.value.length);
  }, [editing, selectAll, inputRef]);
  if (state.phase === 'mirror')
    return (
      <div className="cad-modify-controls cad-mirror-controls" role="group" aria-label="Mirror selection">
        <button type="button" aria-pressed={state.picking === 'entities'} onClick={() => onMirrorPicking('entities')}>
          Entities ({state.entityIds.length})
        </button>
        <button
          type="button"
          aria-pressed={state.picking === 'axis'}
          disabled={!state.entityIds.length}
          onClick={() => onMirrorPicking('axis')}>
          Mirror line
        </button>
        <button type="button" aria-label="Cancel mirror" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  if (state.phase !== 'offset' || !state.entityIds.length) return null;
  return (
    <form
      className="cad-modify-controls cad-offset-controls"
      style={position}
      onSubmit={event => {
        event.preventDefault();
        onAccept();
      }}>
      {state.editing ? (
        <label>
          Offset{' '}
          <CadValueInput
            inputRef={inputRef}
            aria-label="Offset distance"
            inputMode="decimal"
            value={state.text}
            aria-invalid={!!error}
            onChange={event => onText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
              if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
            }}
          />
        </label>
      ) : (
        <button type="button" aria-label="Edit offset distance" onClick={onEdit}>
          {state.text} <CadUnitSuffix text={state.text} />
        </button>
      )}
      <button type="submit" aria-label="Apply offset">
        ✓
      </button>
      <button type="button" aria-label="Cancel offset" onClick={onCancel}>
        ×
      </button>
      {error && (
        <span role="alert" className="cad-error">
          {error}
        </span>
      )}
    </form>
  );
}

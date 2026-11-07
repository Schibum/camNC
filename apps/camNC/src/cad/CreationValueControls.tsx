import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import type { CadSketch } from '@wbcnc/cad';
import { creationValueAt, type CreationValues } from './creationValues';
import { formatCadValue } from './valueExpressions';
import { CadValueInput } from './CadValueInput';

export function CreationValueControls({
  state,
  sketch,
  positions,
  onChange,
  onStart,
  onAccept,
  onCancel,
  inputRef,
}: {
  state: CreationValues;
  sketch: CadSketch;
  positions: (CSSProperties | undefined)[];
  onChange: (text: string) => void;
  onStart: (index: number) => void;
  onAccept: () => void;
  onCancel: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localInput;
  useEffect(() => {
    if (!state.editing || !input.current) return;
    input.current.focus();
    if (state.selectAll) input.current.select();
    else input.current.setSelectionRange(input.current.value.length, input.current.value.length);
  }, [input, state.editing, state.index, state.selectAll]);
  return (
    <>
      {state.steps.map((step, index) => {
        if (index < state.index || !positions[index]) return null;
        const value = creationValueAt(state, sketch, index);
        if (!value) return null;
        if (index === state.index && state.editing)
          return (
            <form
              key={step.entityId}
              className="cad-creation-value cad-creation-value-edit"
              style={positions[index]}
              onSubmit={event => {
                event.preventDefault();
                onAccept();
              }}
              onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancel();
                }
              }}>
              <CadValueInput
                inputRef={input}
                aria-label={`${step.label} value`}
                inputMode="decimal"
                value={state.text}
                onChange={event => onChange(event.target.value)}
              />
              <button type="submit" aria-label={`Apply ${step.label.toLowerCase()}`}>
                ✓
              </button>
              <button type="button" aria-label="Cancel drawing value" onClick={onCancel}>
                ×
              </button>
            </form>
          );
        return (
          <button
            key={step.entityId}
            type="button"
            className="cad-creation-value"
            style={positions[index]}
            aria-label={`${step.label}: ${formatCadValue(value.constraint.value)} mm. Enter a value`}
            onClick={() => onStart(index)}>
            {formatCadValue(value.constraint.value)}
          </button>
        );
      })}
    </>
  );
}

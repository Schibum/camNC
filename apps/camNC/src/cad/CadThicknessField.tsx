import { useEffect, useId, useRef, useState } from 'react';
import { parseCadValue } from './valueExpressions';
import { CadValueInput } from './CadValueInput';
import './cadThicknessField.css';

export interface CadThicknessFieldProps {
  value: number;
  onCommit: (value: number) => void;
  onDone?: () => void;
  onValidityChange?: (valid: boolean) => void;
}

const rangeError = 'Thickness must be between 0.1 and 300 mm.';
function thicknessValue(text: string): { value: number } | { error: string } {
  const parsed = parseCadValue(text, { unit: 'mm' });
  if ('error' in parsed) return parsed;
  return parsed.value >= 0.1 && parsed.value <= 300 ? { value: parsed.value } : { error: rangeError };
}

/** Invalid drafts stay visible until corrected or explicitly canceled; blur never moves focus. */
export function CadThicknessField({ value, onCommit, onDone, onValidityChange }: CadThicknessFieldProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const previousValue = useRef(value);
  const validityCallback = useRef(onValidityChange);
  const lastValidity = useRef<boolean | undefined>(undefined);
  const valid = !('error' in thicknessValue(text));
  useEffect(() => {
    validityCallback.current = onValidityChange;
    if (lastValidity.current !== valid) {
      lastValidity.current = valid;
      onValidityChange?.(valid);
    }
  }, [valid, onValidityChange]);
  useEffect(
    () => () => {
      validityCallback.current?.(true);
    },
    []
  );
  useEffect(() => {
    if (Object.is(previousValue.current, value)) return;
    previousValue.current = value;
    if (!dirty.current) {
      setText(String(value));
      setError(null);
    }
  }, [value]);

  const commit = () => {
    const parsed = thicknessValue(text);
    if ('error' in parsed) {
      setError(parsed.error);
      return false;
    }
    dirty.current = false;
    setText(String(parsed.value));
    setError(null);
    if (parsed.value !== value) onCommit(parsed.value);
    return true;
  };

  return (
    <div className="cad-thickness-field">
      <label className="cad-number-field" htmlFor={id}>
        Thickness
        <span>
          <CadValueInput
            id={id}
            type="text"
            inputMode="decimal"
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            onChange={event => {
              const next = event.target.value;
              dirty.current = true;
              setText(next);
              if (error) {
                const parsed = thicknessValue(next);
                setError('error' in parsed ? parsed.error : null);
              }
            }}
            onBlur={() => {
              if (dirty.current) commit();
            }}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                if (commit()) {
                  event.currentTarget.blur();
                  onDone?.();
                }
              } else if (event.key === 'Escape') {
                event.preventDefault();
                dirty.current = false;
                setText(String(value));
                setError(null);
                event.currentTarget.blur();
                onDone?.();
              }
            }}
          />
        </span>
      </label>
      <p id={`${id}-hint`} className="cad-thickness-hint">
        0.1–300 mm. Units and arithmetic accepted.
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </div>
  );
}

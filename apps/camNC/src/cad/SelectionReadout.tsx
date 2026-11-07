import type { CadPoint, CadSketch } from '@wbcnc/cad';
import { selectionMeasurements } from './selectionMeasurements';
import { formatCadValue } from './valueExpressions';
import './selectionReadout.css';

export interface SelectionReadoutProps {
  sketch: CadSketch;
  selectedIds: readonly string[];
  picks?: Readonly<Record<string, CadPoint>>;
  className?: string;
}

export function SelectionReadout({ sketch, selectedIds, picks, className }: SelectionReadoutProps) {
  const measurements = selectionMeasurements(sketch, selectedIds, picks);
  if (!measurements.length) return null;
  return (
    <div
      role="status"
      aria-label="Selection measurements"
      aria-atomic="true"
      className={['cad-selection-readout', className].filter(Boolean).join(' ')}>
      <dl>
        {measurements.map(measurement => (
          <div key={measurement.label}>
            <dt>{measurement.label}</dt>
            <dd>
              {formatCadValue(measurement.value)}
              {measurement.unit === 'deg' ? '°' : ' mm'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

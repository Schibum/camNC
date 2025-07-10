import { getCncApi } from '@/lib/fluidnc/fluidnc-singleton';
import { useShowMachineZero } from '@/store/store';
import { LineAxesHelper } from './LineAxesHelper';

/**
 * MachineZeroAxes renders a small XYZ axes helper at the current
 * workspace zero as reported by FluidNC (via active offset modal).
 */
export function MachineZeroAxes({ size = 20 }: { size?: number }) {
  'use no memo';
  const visible = useShowMachineZero();

  const cncApi = getCncApi();

  const zero = cncApi.currentZero.value;
  if (!zero || !visible) return null;

  const zElev = 21;

  return (
    <group position={[zero.x, zero.y, zElev] as any}>
      <LineAxesHelper size={size} lineWidth={1} />
    </group>
  );
}

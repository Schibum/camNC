import { isManufacturingLocked } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';

/** Let the user pick a G-code file and load it as the toolpath. */
export function openGcodeFile() {
  if (isManufacturingLocked()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gcode, .nc';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const gcode = await file.text();
    if (!isManufacturingLocked()) useStore.getState().updateToolpath(gcode, file.name);
  };
  input.click();
}

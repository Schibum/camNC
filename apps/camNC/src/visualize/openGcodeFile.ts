import { useStore } from '@/store/store';

/** Let the user pick a G-code file and load it as the toolpath. */
export function openGcodeFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gcode, .nc';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) useStore.getState().updateToolpath(await file.text(), file.name);
  };
  input.click();
}

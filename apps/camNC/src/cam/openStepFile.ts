import { useCamJob } from './camJobStore';

export const kStepFile = /\.(step|stp)$/i;

/** Let the user pick a STEP file and import it into the CAM page. */
export function openStepFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.step,.stp';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void useCamJob.getState().openStep(file);
  };
  input.click();
}

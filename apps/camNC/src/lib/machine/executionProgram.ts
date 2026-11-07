/** Proven bytes and immutable SD object of the last dispatch or matched running recovery in this page. */
let execution: { file: string; gcode: string } | null = null;
const basename = (file: string) => file.split('/').pop();

export function rememberExecutionProgram(file: string, gcode: string) {
  execution = { file: basename(file) ?? file, gcode };
}

export function isKnownExecutionFile(file: string) {
  return !!execution && basename(file) === execution.file;
}

export function isKnownExecutionProgram(file: string, gcode: string) {
  return isKnownExecutionFile(file) && execution?.gcode === gcode;
}

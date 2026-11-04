/** What to drop instead of a file we can't open: CAM pages take models, the rest G-code (or a model to start CAM). */
export function wrongFileMessage(pathname: string) {
  return pathname.startsWith('/cam')
    ? 'Drop a STEP or STL model (.step, .stp, .stl) to start a CAM job.'
    : 'Drop a G-code file (.gcode or .nc), or a STEP/STL model to start a CAM job.';
}

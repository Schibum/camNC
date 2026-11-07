/** A trapped/aborted WASM engine cannot be trusted for a later sketch request. */
export function isFatalSolverError(error: unknown): boolean {
  return (
    (typeof WebAssembly !== 'undefined' && error instanceof WebAssembly.RuntimeError) ||
    /(?:out of memory|\boom\b|memory access out of bounds|aborted\()/i.test(error instanceof Error ? error.message : String(error))
  );
}

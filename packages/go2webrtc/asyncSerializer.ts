/**
 * Creates a serializer that ensures async operations run sequentially
 * by chaining them one after another.
 */
export function createSerializer() {
  let lastPromise: Promise<unknown> = Promise.resolve();

  return async <R>(fn: () => Promise<R>): Promise<R> => {
    // Run after the previous task settled, regardless of whether it failed. `lastPromise` never rejects, so
    // `fn` runs exactly once.
    const result = lastPromise.then(() => fn());

    // Update the lastPromise to this new promise chain (ignore errors to prevent unhandled rejections)
    lastPromise = result.catch(() => {});

    // Return the result promise so caller gets proper resolve/reject
    return result;
  };
}

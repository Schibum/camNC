/**
 * Creates a serializer that ensures async operations run sequentially
 * by chaining them one after another.
 */
export function createSerializer() {
  let lastPromise: Promise<unknown> = Promise.resolve();

  return async <R>(fn: () => Promise<R>): Promise<R> => {
    // Create a new promise chain that starts after the previous task
    const result = lastPromise.then(() => fn()).catch(() => fn()); // If previous task failed, still run new task

    // Update the lastPromise to this new promise chain (ignore errors to prevent unhandled rejections)
    lastPromise = result.catch(() => {});

    // Return the result promise so caller gets proper resolve/reject
    return result;
  };
}

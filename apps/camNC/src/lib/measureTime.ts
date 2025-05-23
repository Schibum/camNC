export async function measureTime<T>(fn: () => Promise<T>, name: string) {
  const startTime = performance.now();
  const result = await fn();
  const endTime = performance.now();
  console.log(`Time taken for ${name}: ${endTime - startTime} ms`);
  return result;
}

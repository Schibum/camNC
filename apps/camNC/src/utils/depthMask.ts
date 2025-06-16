export function depthFloodFillMask(
  data: Float32Array,
  width: number,
  height: number,
  seedIdx: number,
  { threshold = 0.01, connectivity = 4 }: { threshold?: number; connectivity?: 4 | 8 } = {}
): { mask: Uint8Array; hits: number } {
  if (seedIdx < 0 || seedIdx >= data.length) {
    throw new Error(`seedIdx ${seedIdx} out of bounds for depth map of length ${data.length}`);
  }

  const mask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [seedIdx];
  visited[seedIdx] = 1;

  const seedVal = data[seedIdx];
  let hits = 0;

  const neighbourOffsets4 = [-1, 1, -width, width];
  const neighbourOffsets8 = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];
  const neighbourOffsets = connectivity === 8 ? neighbourOffsets8 : neighbourOffsets4;

  while (queue.length > 0) {
    const current = queue.pop()!;
    mask[current] = 255;
    hits++;

    for (const offset of neighbourOffsets) {
      const neighbourIdx = current + offset;

      // Quick bounds check to avoid modulo calculations for 1D index validity
      if (neighbourIdx < 0 || neighbourIdx >= data.length) continue;
      // Prevent wrapping across rows for left/right neighbours
      if ((offset === -1 && current % width === 0) || (offset === 1 && current % width === width - 1)) {
        continue;
      }

      if (visited[neighbourIdx]) continue;
      visited[neighbourIdx] = 1;

      if (Math.abs(data[neighbourIdx] - seedVal) < threshold) {
        queue.push(neighbourIdx);
      }
    }
  }

  return { mask, hits };
}

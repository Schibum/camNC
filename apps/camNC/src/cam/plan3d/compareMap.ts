import { CanvasTexture, LinearFilter, type Texture } from 'three';
import type { HeightmapDomain } from '@/visualize/stockSim/HeightmapStamper';
import type { BoardRequest, CamPartInfo } from '../camTypes';

/** How close to the model the cut counts as right, mm. */
export const kCompareTolerance = 0.1;

export type CompareClass = 'ok' | 'left' | 'over' | 'none';

/**
 * One spot of the simulated board against the model: `sim` the cut height there, `lo`..`hi` the model's height around
 * it (a cell either way, so a wall's edge doesn't count as wrong), `through` where the model is cut through (holes).
 * Mirrors the shader in SimStock.
 */
export function compareClass(
  sim: number,
  lo: number,
  hi: number,
  judged: boolean,
  through: boolean,
  tol = kCompareTolerance
): CompareClass {
  if (!judged) return 'none';
  if (through) return sim <= tol ? 'ok' : 'left';
  if (sim < lo - tol) return 'over';
  if (sim > hi + tol) return 'left';
  return 'ok';
}

/**
 * The model's heights on the board, as a texture over the simulation's footprint: R the height (normalized to the
 * domain's Z range), G = 1 where it's judged (inside a part), B = 1 where it's cut through (holes). The parts' tops are
 * the stock top (an allowance on top is not faced); pocket floors at their depth below the part's top.
 */
export function designTexture(board: BoardRequest, parts: CamPartInfo[], domain: HeightmapDomain): Texture {
  const { footprint, width, height, zLow, zTop } = domain;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const sx = width / (footprint.max.x - footprint.min.x);
  const sy = height / (footprint.max.y - footprint.min.y);
  // Board mm -> canvas px (canvas y down, the texture's v up).
  const px = (x: number, y: number): [number, number] => [(x - footprint.min.x) * sx, height - (y - footprint.min.y) * sy];
  const level = (z: number) => Math.round(255 * Math.min(1, Math.max(0, (z - zLow) / (zTop - zLow))));
  const byId = new Map(parts.map(p => [p.id, p]));
  const fill = (loops: [number, number][][], toBoard: (q: [number, number]) => [number, number], rgb: [number, number, number]) => {
    ctx.beginPath();
    for (const loop of loops) loop.forEach((q, i) => (i ? ctx.lineTo(...px(...toBoard(q))) : ctx.moveTo(...px(...toBoard(q)))));
    ctx.closePath();
    ctx.fillStyle = `rgb(${rgb.join(',')})`;
    ctx.fill('evenodd');
  };
  ctx.fillStyle = 'rgb(0,0,0)';
  ctx.fillRect(0, 0, width, height);
  for (const placed of board.parts) {
    const part = byId.get(placed.partId);
    if (!part) continue;
    // Part frame -> board frame, as in @wbcnc/cam partToBoard.
    const toBoard = ([x, y]: [number, number]): [number, number] =>
      placed.rotated ? [placed.x + part.size[1] - y, placed.y + x] : [placed.x + x, placed.y + y];
    fill(part.shape.outlines, toBoard, [level(zTop), 255, 0]);
    for (const p of [...part.shape.pockets].sort((a, b) => a.depth - b.depth))
      fill(p.region, toBoard, [level(part.thickness - p.depth), 255, 0]);
    if (part.shape.holes.length) fill(part.shape.holes, toBoard, [0, 255, 255]);
  }
  const texture = new CanvasTexture(canvas);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

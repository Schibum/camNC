/**
 * RadialHeatmapTracker
 * --------------------
 * Maintains a polar (rings × sectors) bin map and triggers a tick
 * on the `onUpdate$` signal whenever the heatmap changes.
 * The raw `heatmap` buffer remains available for read.
 */
export interface Corner {
  x: number;
  y: number;
}
/**
 * GridHeatmapTracker
 * ------------------
 * Maintains an rows×cols occupancy grid and invokes onUpdate whenever a new cell is hit.
 */
export class GridHeatmapTracker {
  readonly bins: Uint8Array;

  /**
   * @param rows    Number of grid rows (vertical)
   * @param cols    Number of grid columns (horizontal)
   * @param width   Frame width in px
   * @param height  Frame height in px
   */
  constructor(
    readonly rows: number,
    readonly cols: number,
    readonly width: number,
    readonly height: number,
  ) {
    if (rows < 1 || cols < 1) {
      throw new Error("rows & cols must be ≥ 1");
    }
    this.bins = new Uint8Array(rows * cols);
  }

  /** clear grid and notify */
  clear() {
    this.bins.fill(0);
  }

  /**
   * Visit each corner, mark its bin, and notify if any new cell is hit.
   */
  addCorners(corners: Corner[]): void {
    const { rows, cols, bins, width, height } = this;
    const seen = new Set<number>();
    for (const { x, y } of corners) {
      const gx = Math.min(cols - 1, Math.floor((x / width) * cols));
      const gy = Math.min(rows - 1, Math.floor((y / height) * rows));
      const idx = gy * cols + gx;
      seen.add(idx);
    }
    // increment each bin once per frame
    for (const idx of seen) {
      bins[idx]!++;
    }
  }

  /** fraction of cells visited */
  coverage() {
    let visited = 0;
    for (const v of this.bins) if (v) visited++;
    return visited / this.bins.length;
  }

  /** true when full coverage */
  isComplete() {
    return !Array.from(this.bins).some((v) => v === 0);
  }
}

import { useEffect, useRef } from "react";
import { useCalibrationStore } from "../store/calibrationStore";

/**
 * GridHeatmapOverlay
 * ------------------
 * Draws a softly-blurred bins×rows grid over the image, plus an arrow
 * pointing to the nearest unseen cell relative to the current centroid.
 */
export interface GridHeatmapOverlayProps {
  bins: Uint8Array; // length = rows*cols, 0=unseen, 1=seen
  rows: number;
  cols: number;
  frameW: number;
  frameH: number;
  centroid?: { x: number; y: number } | null;
}

export function GridHeatmapOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tracker = useCalibrationStore((s) => s.heatmapTracker);
  const tick = useCalibrationStore((s) => s.heatmapTick);
  if (!tracker) {
    throw new Error("No heatmap tracker available");
  }
  const { bins, rows, cols, width, height } = tracker;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = 1; // window.devicePixelRatio || 1;
    // canvas.width = frameW * dpr;
    // canvas.height = frameH * dpr;
    // canvas.style.width = `${frameW}px`;
    // canvas.style.height = `${frameH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cellW = width / cols;
    const cellH = height / rows;

    const maxHit = Math.min(5, Math.max(3, ...bins));
    console.log(`maxHit: ${maxHit}`);
    // draw bins
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const hit = bins[idx] ?? 0;

        // Map hit count to 3 colors: red -> yellow -> green
        const getHitColor = (count: number): string => {
          const normalized = count / maxHit;
          const alpha = 0.2;

          if (normalized <= 0.33) return `rgba(239,68,68,${alpha + 0.1})`; // red
          if (normalized <= 0.66) return `rgba(251,191,36,${alpha})`; // yellow
          return `rgba(34,197,94,${alpha})`; // green for 2+
        };

        ctx.fillStyle = getHitColor(hit);
        const x = c * cellW + 1;
        const y = r * cellH + 1;
        const w = cellW - 2;
        const h = cellH - 2;

        const rrad = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, rrad);
        ctx.closePath();
        ctx.fill();
      }
    }
  }, [bins, rows, cols, width, height, tick]);

  return (
    <canvas
      ref={canvasRef}
      // className="w-full h-full filter blur-md"
      className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none fliter "
      width={width}
      height={height}
    />
  );
}

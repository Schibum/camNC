import GCodeToolpath, { Modal, Vector3D } from 'gcode-toolpath';
import { Box3, Vector3 } from 'three';

export class ParsedToolpath {
  public pathPoints: Vector3[] = [];
  // Index of the modal that corresponds to the path point (starting point of the segment)
  public modals: Modal[] = [];
  public numArcSegments = 30;
  private bounds?: Box3;
  // Original GCode string
  public gcode: string = '';

  constructor() {}

  addLine(modal: Modal, start: Vector3, end: Vector3) {
    if (this.pathPoints.length === 0) {
      this.pathPoints.push(start);
      this.modals.push(modal);
    }
    this.pathPoints.push(end);
    this.modals.push(modal);
  }

  addArc(modal: Modal, start: Vector3, end: Vector3, center: Vector3) {
    const isCounterClockwise = modal.motion === 'G3';
    const points = generateArcPoints(start, end, center, isCounterClockwise, modal.plane, this.numArcSegments);
    this.pathPoints.push(...points);
    const modals = new Array(points.length).fill(modal);
    this.modals.push(...modals);
  }

  private updateBounds() {
    const box = new Box3();
    box.setFromPoints(this.pathPoints);
    this.bounds = box;
  }

  getBounds() {
    if (!this.bounds) {
      this.updateBounds();
    }
    return this.bounds!;
  }
}

export interface Tool {
  number: number;
  diameter: number;
  color: string;
}

/**
 * Parse GCode string into toolpath segments
 */
export function parseGCode(gcode: string): ParsedToolpath {
  const parsed = new ParsedToolpath();

  try {
    // Create a new toolpath instance with callbacks
    const toolpath = new GCodeToolpath({
      // Default starting position
      position: { x: 0, y: 0, z: 0 },

      // Callback for line segments
      addLine: (modal: Modal, v1: Vector3D, v2: Vector3D) => {
        parsed.addLine(modal, new Vector3(v1.x, v1.y, v1.z), new Vector3(v2.x, v2.y, v2.z));
      },

      // Callback for arc segments
      addArcCurve: (modal: Modal, v1: Vector3D, v2: Vector3D, v0: Vector3D) => {
        parsed.addArc(modal, new Vector3(v1.x, v1.y, v1.z), new Vector3(v2.x, v2.y, v2.z), new Vector3(v0.x, v0.y, v0.z));
      },
    });

    toolpath.loadFromStringSync(gcode);
    parsed.gcode = gcode;
    return parsed;
  } catch (error) {
    console.error('Error parsing GCode:', error);
    throw error;
  }
}

type GPlane = 'G17' | 'G18' | 'G19';

export function generateArcPoints(
  start: Vector3, // v1 — transformed to XY plane
  end: Vector3, // v2 — transformed to XY plane
  center: Vector3, // v0 — transformed to XY plane
  isCounterClockwise: boolean,
  plane: GPlane = 'G17',
  numPoints = 30
): Vector3[] {
  const points: Vector3[] = [];

  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let endAngle = Math.atan2(end.y - center.y, end.x - center.x);

  // Handle full-circle case
  if (Math.abs(startAngle - endAngle) < 0.0001) {
    endAngle += isCounterClockwise ? 2 * Math.PI : -2 * Math.PI;
  }

  // Adjust for direction
  if (isCounterClockwise && endAngle < startAngle) {
    endAngle += 2 * Math.PI;
  } else if (!isCounterClockwise && endAngle > startAngle) {
    endAngle -= 2 * Math.PI;
  }

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const angle = startAngle + (endAngle - startAngle) * t;

    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    const z = start.z + (end.z - start.z) * t;

    let vertex: Vector3;

    // Reproject from arc-in-XY-plane back to 3D space
    if (plane === 'G17') {
      vertex = new Vector3(x, y, z);
    } else if (plane === 'G18') {
      vertex = new Vector3(y, z, x); // XZ plane
    } else if (plane === 'G19') {
      vertex = new Vector3(z, x, y); // YZ plane
    } else {
      throw new Error(`Unsupported plane: ${plane}`);
    }

    points.push(vertex);
  }

  return points;
}

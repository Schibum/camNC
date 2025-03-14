import GCodeToolpath, { Modal, Vector3D } from 'gcode-toolpath';
import * as THREE from 'three';
import { Vector3, Box3 } from 'three';

export class ParsedToolpath {
  public pathPoints: Vector3[] = [];
  // Index of the modal that corresponds to the path point (starting point of the segment)
  public modals: Modal[] = [];
  public numArcSegments = 8;
  private bounds?: Box3;

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
    const points = generateArcPoints(start, end, center, isCounterClockwise, this.numArcSegments);
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
        parsed.addArc(
          modal,
          new Vector3(v1.x, v1.y, v1.z),
          new Vector3(v2.x, v2.y, v2.z),
          new Vector3(v0.x, v0.y, v0.z)
        );
      },
    });

    toolpath.loadFromStringSync(gcode);
    return parsed;
  } catch (error) {
    console.error('Error parsing GCode:', error);
    throw error;
  }
}

/**
 * Generate points for an arc curve
 */
export function generateArcPoints(
  start: Vector3,
  end: Vector3,
  center: Vector3,
  isCounterClockwise: boolean,
  numPoints = 8
): Vector3[] {
  const points: THREE.Vector3[] = [];

  // Calculate radius
  const radius = Math.sqrt(Math.pow(start.x - center.x, 2) + Math.pow(start.y - center.y, 2));

  // Calculate angles
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

  // // G2 is clockwise, G3 is counter-clockwise
  // const isCounterClockwise = motion === 'G3';

  // Handle full circles
  let actualEndAngle = endAngle;
  if (Math.abs(startAngle - endAngle) < 0.01) {
    actualEndAngle = startAngle + (isCounterClockwise ? 2 * Math.PI : -2 * Math.PI);
  }

  // Ensure proper direction
  if (isCounterClockwise && actualEndAngle < startAngle) {
    actualEndAngle += 2 * Math.PI;
  } else if (!isCounterClockwise && actualEndAngle > startAngle) {
    actualEndAngle -= 2 * Math.PI;
  }

  // Interpolate z-value
  const zDiff = end.z - start.z;

  // Generate points along the arc
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const angle = startAngle + (actualEndAngle - startAngle) * t;
    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    const z = start.z + zDiff * t;

    points.push(new THREE.Vector3(x, y, z));
  }

  return points;
}

/**
 * Creates a THREE.Shape for a path with given points and half-width
 */
export function createShapeForPath(points: THREE.Vector3[], halfWidth: number): THREE.Shape {
  const shape = new THREE.Shape();

  // Calculate perpendicular vectors for each point
  const { perpXs, perpYs } = calculatePerpendicularVectors(points);

  // Create the outline path with rounded joints
  const outlinePath = new THREE.Path();

  // Start with a rounded cap at the beginning
  addStartCap(outlinePath, points[0], perpXs[0], perpYs[0], halfWidth);

  // Add the right side of the path with rounded joints
  addRightSidePath(outlinePath, points, perpXs, perpYs, halfWidth);

  // Add end cap (half circle)
  addEndCap(
    outlinePath,
    points[points.length - 1],
    perpXs[points.length - 1],
    perpYs[points.length - 1],
    halfWidth
  );

  // Add the left side of the path with rounded joints (going backwards)
  addLeftSidePath(outlinePath, points, perpXs, perpYs, halfWidth);

  // Close the path
  outlinePath.closePath();

  // Add the outline to the shape
  shape.add(outlinePath);

  return shape;
}

/**
 * Calculates perpendicular vectors for each segment in the path
 */
function calculatePerpendicularVectors(points: THREE.Vector3[]): {
  perpXs: number[];
  perpYs: number[];
} {
  const perpXs: number[] = [];
  const perpYs: number[] = [];

  // Calculate perpendicular vectors for each segment
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len > 0) {
      perpXs.push(-dy / len);
      perpYs.push(dx / len);
    } else {
      // If segment is too short, use previous perp vector or default
      perpXs.push(perpXs.length > 0 ? perpXs[perpXs.length - 1] : 0);
      perpYs.push(perpYs.length > 0 ? perpYs[perpYs.length - 1] : 1);
    }
  }

  // For the last point, use the last perpendicular vector
  perpXs.push(perpXs[perpXs.length - 1]);
  perpYs.push(perpYs[perpYs.length - 1]);

  return { perpXs, perpYs };
}

/**
 * Adds a start cap (half circle) to the path
 */
function addStartCap(
  path: THREE.Path,
  point: THREE.Vector3,
  perpX: number,
  perpY: number,
  halfWidth: number
): void {
  const startCapCenter = new THREE.Vector2(point.x, point.y);
  const startCapStart = new THREE.Vector2(point.x + perpX * halfWidth, point.y + perpY * halfWidth);
  const startAngle = Math.atan2(perpY, perpX);

  // Move to the start of the cap
  path.moveTo(startCapStart.x, startCapStart.y);

  // Add half-circle for the start cap
  path.absarc(
    startCapCenter.x,
    startCapCenter.y,
    halfWidth,
    startAngle,
    startAngle + Math.PI,
    false
  );
}

/**
 * Adds an end cap (half circle) to the path
 */
function addEndCap(
  path: THREE.Path,
  point: THREE.Vector3,
  perpX: number,
  perpY: number,
  halfWidth: number
): void {
  const endAngle = Math.atan2(-perpY, -perpX);

  path.absarc(point.x, point.y, halfWidth, endAngle, endAngle + Math.PI, false);
}

/**
 * Adds the right side of the path with rounded joints
 */
function addRightSidePath(
  path: THREE.Path,
  points: THREE.Vector3[],
  perpXs: number[],
  perpYs: number[],
  halfWidth: number
): void {
  for (let i = 1; i < points.length; i++) {
    const currPoint = points[i];
    const prevPerpX = -perpXs[i - 1];
    const prevPerpY = -perpYs[i - 1];
    const currPerpX = -perpXs[i];
    const currPerpY = -perpYs[i];

    // Check if direction changes significantly
    const prevAngle = Math.atan2(prevPerpY, prevPerpX);
    const currAngle = Math.atan2(currPerpY, currPerpX);

    // Calculate angle difference, normalized to [-PI, PI]
    let angleDiff = currAngle - prevAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // The cross product determines if this is an inside or outside corner
    const crossProduct = prevPerpX * currPerpY - prevPerpY * currPerpX;
    const isOutsideCorner = crossProduct < 0;

    if (Math.abs(angleDiff) > 0.1) {
      // Line to the end of the previous segment
      path.lineTo(currPoint.x + prevPerpX * halfWidth, currPoint.y + prevPerpY * halfWidth);

      if (isOutsideCorner) {
        // For outside corners, just create a sharp corner rather than an arc
        path.lineTo(currPoint.x + currPerpX * halfWidth, currPoint.y + currPerpY * halfWidth);
      } else {
        // For inside corners, use a rounded joint with the arc
        // The arc direction is determined by the sign of the angle difference
        path.absarc(currPoint.x, currPoint.y, halfWidth, prevAngle, currAngle, angleDiff < 0);
      }
    } else {
      // If angles are similar, just continue with a line
      path.lineTo(currPoint.x + currPerpX * halfWidth, currPoint.y + currPerpY * halfWidth);
    }
  }
}

/**
 * Adds the left side of the path with rounded joints (going backwards)
 */
function addLeftSidePath(
  path: THREE.Path,
  points: THREE.Vector3[],
  perpXs: number[],
  perpYs: number[],
  halfWidth: number
): void {
  for (let i = points.length - 2; i >= 0; i--) {
    const currPoint = points[i];
    const prevPerpX = perpXs[i + 1];
    const prevPerpY = perpYs[i + 1];
    const currPerpX = perpXs[i];
    const currPerpY = perpYs[i];

    // Check if direction changes significantly
    const prevAngle = Math.atan2(prevPerpY, prevPerpX);
    const currAngle = Math.atan2(currPerpY, currPerpX);

    // Calculate angle difference, normalized to [-PI, PI]
    let angleDiff = currAngle - prevAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // The cross product determines if this is an inside or outside corner
    // Note: Since we're going backwards, the meaning of inside/outside is reversed
    const crossProduct = prevPerpX * currPerpY - prevPerpY * currPerpX;
    const isOutsideCorner = crossProduct > 0;

    if (Math.abs(angleDiff) > 0.1) {
      // Line to the end of the previous segment
      path.lineTo(currPoint.x + prevPerpX * halfWidth, currPoint.y + prevPerpY * halfWidth);

      if (isOutsideCorner) {
        // For outside corners, just create a sharp corner rather than an arc
        path.lineTo(currPoint.x + currPerpX * halfWidth, currPoint.y + currPerpY * halfWidth);
      } else {
        // For inside corners, use a rounded joint with the arc
        // The arc direction is determined by the sign of the angle difference
        path.absarc(currPoint.x, currPoint.y, halfWidth, prevAngle, currAngle, angleDiff < 0);
      }
    } else {
      // If angles are similar, just continue with a line
      path.lineTo(currPoint.x + currPerpX * halfWidth, currPoint.y + currPerpY * halfWidth);
    }
  }
}

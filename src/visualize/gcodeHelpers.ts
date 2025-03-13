import GCodeToolpath, { Modal, Vector3D } from 'gcode-toolpath';
import * as THREE from 'three';

export interface Tool {
  number: number;
  diameter: number;
  color: string;
}

export interface ToolpathSegment {
  motion: string;
  tool: number;
  v1: Vector3D;
  v2: Vector3D;
  v0?: Vector3D; // For arc curves
  isArc: boolean;
}

export interface GCodeBounds {
  min: THREE.Vector2;
  max: THREE.Vector2;
  size: THREE.Vector2;
}

export interface ParsedGCode {
  toolpathSegments: ToolpathSegment[];
  bounds: GCodeBounds;
  error?: string;
}

/**
 * Parse GCode string into toolpath segments
 */
export function parseGCode(gcode: string): ParsedGCode {
  const segments: ToolpathSegment[] = [];

  try {
    // Create a new toolpath instance with callbacks
    const toolpath = new GCodeToolpath({
      // Default starting position
      position: { x: 0, y: 0, z: 0 },

      // Callback for line segments
      addLine: (modal: Modal, v1: Vector3D, v2: Vector3D) => {
        segments.push({
          motion: modal.motion || 'G0',
          tool: modal.tool || 1,
          v1: { ...v1 },
          v2: { ...v2 },
          isArc: false,
        });
      },

      // Callback for arc segments
      addArcCurve: (modal: Modal, v1: Vector3D, v2: Vector3D, v0: Vector3D) => {
        segments.push({
          motion: modal.motion || 'G0',
          tool: modal.tool || 1,
          v1: { ...v1 },
          v2: { ...v2 },
          v0: { ...v0 },
          isArc: true,
        });
      },
    });

    // Load the GCODE string
    toolpath.loadFromStringSync(gcode);

    // Calculate bounds
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    segments.forEach(segment => {
      // Check start point
      minX = Math.min(minX, segment.v1.x);
      maxX = Math.max(maxX, segment.v1.x);
      minY = Math.min(minY, segment.v1.y);
      maxY = Math.max(maxY, segment.v1.y);

      // Check end point
      minX = Math.min(minX, segment.v2.x);
      maxX = Math.max(maxX, segment.v2.x);
      minY = Math.min(minY, segment.v2.y);
      maxY = Math.max(maxY, segment.v2.y);

      // If it's an arc, also check the center point
      if (segment.v0) {
        minX = Math.min(minX, segment.v0.x);
        maxX = Math.max(maxX, segment.v0.x);
        minY = Math.min(minY, segment.v0.y);
        maxY = Math.max(maxY, segment.v0.y);
      }
    });

    // Add fallback if no segments were found or bounds couldn't be calculated
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      minX = -100;
      minY = -100;
      maxX = 100;
      maxY = 100;
    }

    return {
      toolpathSegments: segments,
      bounds: {
        min: new THREE.Vector2(minX, minY),
        max: new THREE.Vector2(maxX, maxY),
        size: new THREE.Vector2(maxX - minX, maxY - minY),
      },
    };
  } catch (error) {
    console.error('Error parsing GCode:', error);
    return {
      toolpathSegments: [],
      bounds: {
        min: new THREE.Vector2(-100, -100),
        max: new THREE.Vector2(100, 100),
        size: new THREE.Vector2(200, 200),
      },
      error: error instanceof Error ? error.message : 'Unknown error parsing GCode',
    };
  }
}

/**
 * Generate points for an arc curve
 */
export function generateArcPoints(segment: ToolpathSegment, numPoints = 8): THREE.Vector3[] {
  if (!segment.isArc || !segment.v0)
    return [
      new THREE.Vector3(segment.v1.x, segment.v1.y, segment.v1.z),
      new THREE.Vector3(segment.v2.x, segment.v2.y, segment.v2.z),
    ];

  const { v0, v1, v2, motion } = segment;
  const points: THREE.Vector3[] = [];

  // Calculate radius
  const radius = Math.sqrt(Math.pow(v1.x - v0.x, 2) + Math.pow(v1.y - v0.y, 2));

  // Calculate angles
  const startAngle = Math.atan2(v1.y - v0.y, v1.x - v0.x);
  const endAngle = Math.atan2(v2.y - v0.y, v2.x - v0.x);

  // G2 is clockwise, G3 is counter-clockwise
  const isCounterClockwise = motion === 'G3';

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
  const zDiff = v2.z - v1.z;

  // Generate points along the arc
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const angle = startAngle + (actualEndAngle - startAngle) * t;
    const x = v0.x + radius * Math.cos(angle);
    const y = v0.y + radius * Math.sin(angle);
    const z = v1.z + zDiff * t;

    points.push(new THREE.Vector3(x, y, z));
  }

  return points;
}

/**
 * Group toolpath segments by tool and motion type
 */
export function groupSegmentsByTool(
  toolpathSegments: ToolpathSegment[]
): Record<number, { rapid: ToolpathSegment[]; cutting: ToolpathSegment[] }> {
  const result: Record<number, { rapid: ToolpathSegment[]; cutting: ToolpathSegment[] }> = {};

  toolpathSegments.forEach(segment => {
    const toolNumber = segment.tool;

    if (!result[toolNumber]) {
      result[toolNumber] = {
        rapid: [],
        cutting: [],
      };
    }

    if (segment.motion === 'G0') {
      result[toolNumber].rapid.push(segment);
    } else {
      result[toolNumber].cutting.push(segment);
    }
  });

  return result;
}

/**
 * Group toolpath segments by z-height
 */
export function groupSegmentsByZ(segments: ToolpathSegment[]): Record<number, ToolpathSegment[]> {
  const result: Record<number, ToolpathSegment[]> = {};

  segments.forEach(segment => {
    // Use the z-height of the starting point as the layer identifier
    // Round to 3 decimal places to handle floating point imprecision
    const zHeight = Math.round(segment.v1.z * 1000) / 1000;

    if (!result[zHeight]) {
      result[zHeight] = [];
    }

    result[zHeight].push(segment);
  });

  return result;
}

/**
 * Checks if two points are equal within a given tolerance
 */
function arePointsEqual(p1: Vector3D, p2: Vector3D, tolerance = 0.001): boolean {
  return (
    Math.abs(p1.x - p2.x) < tolerance &&
    Math.abs(p1.y - p2.y) < tolerance &&
    Math.abs(p1.z - p2.z) < tolerance
  );
}

/**
 * Groups connected segments together to form continuous paths
 */
function groupConnectedSegments(
  segments: ToolpathSegment[],
  tolerance = 0.001
): ToolpathSegment[][] {
  if (segments.length === 0) return [];

  const paths: ToolpathSegment[][] = [];
  let currentPath: ToolpathSegment[] = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const prevSegment = currentPath[currentPath.length - 1];
    const currentSegment = segments[i];

    // Check if segments are connected (with tolerance)
    if (arePointsEqual(prevSegment.v2, currentSegment.v1, tolerance)) {
      currentPath.push(currentSegment);
    } else {
      // Start a new path
      paths.push(currentPath);
      currentPath = [currentSegment];
    }
  }

  // Add the last path
  if (currentPath.length > 0) {
    paths.push(currentPath);
  }

  return paths;
}

/**
 * Create THREE.Shape geometries for toolpath segments
 */
export function createToolpathGeometries(
  segmentsByTool: Record<number, { rapid: ToolpathSegment[]; cutting: ToolpathSegment[] }>,
  toolDiameter: number
): Record<string, { rapid: THREE.ShapeGeometry[]; cutting: THREE.ShapeGeometry[] }> {
  const result: Record<string, { rapid: THREE.ShapeGeometry[]; cutting: THREE.ShapeGeometry[] }> =
    {};

  Object.entries(segmentsByTool).forEach(([toolNumber, segments]) => {
    // Create a tool with the diameter from the store
    const tool = {
      diameter: toolDiameter,
      color: `hsl(${(parseInt(toolNumber, 10) * 137) % 360}, 70%, 50%)`,
      number: parseInt(toolNumber, 10),
    };

    const halfWidth = tool.diameter / 2;

    result[toolNumber] = {
      rapid: [],
      cutting: [],
    };

    // Process rapid movements by grouping them by z-height
    const rapidByZ = groupSegmentsByZ(segments.rapid);

    Object.entries(rapidByZ).forEach(([zHeight, zSegments]) => {
      // Group connected segments to form continuous paths
      const connectedPaths = groupConnectedSegments(zSegments);

      // Process each connected path
      connectedPaths.forEach(pathSegments => {
        // Collect all points for the entire path
        let allPoints: THREE.Vector3[] = [];

        pathSegments.forEach(segment => {
          const segmentPoints = generateArcPoints(segment, segment.isArc ? 16 : 2);

          // If this is not the first segment, remove the first point to avoid duplication
          if (allPoints.length > 0 && segmentPoints.length > 0) {
            allPoints = allPoints.concat(segmentPoints.slice(1));
          } else {
            allPoints = allPoints.concat(segmentPoints);
          }
        });

        // Skip paths that are too short
        if (allPoints.length < 2) return;

        // Create a shape for this path using THREE.Shape
        const shape = new THREE.Shape();
        const path = new THREE.Path();

        // Calculate perpendicular vectors for each point
        const perpXs: number[] = [];
        const perpYs: number[] = [];

        // Calculate perpendicular vectors for each segment
        for (let i = 0; i < allPoints.length - 1; i++) {
          const p1 = allPoints[i];
          const p2 = allPoints[i + 1];
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

        // Create the outline path with rounded joints
        const outlinePath = new THREE.Path();

        // Start with a rounded cap at the beginning
        const firstPoint = allPoints[0];
        const firstPerpX = perpXs[0];
        const firstPerpY = perpYs[0];

        // Add starting cap (half circle)
        const startCapCenter = new THREE.Vector2(firstPoint.x, firstPoint.y);
        const startCapStart = new THREE.Vector2(
          firstPoint.x + firstPerpX * halfWidth,
          firstPoint.y + firstPerpY * halfWidth
        );
        const startAngle = Math.atan2(firstPerpY, firstPerpX);
        const startCapEnd = new THREE.Vector2(
          firstPoint.x - firstPerpX * halfWidth,
          firstPoint.y - firstPerpY * halfWidth
        );

        // Move to the start of the cap
        outlinePath.moveTo(startCapStart.x, startCapStart.y);

        // Add half-circle for the start cap
        outlinePath.absarc(
          startCapCenter.x,
          startCapCenter.y,
          halfWidth,
          startAngle,
          startAngle + Math.PI,
          false
        );

        // Add the right side of the path with rounded joints
        for (let i = 1; i < allPoints.length; i++) {
          const prevPoint = allPoints[i - 1];
          const currPoint = allPoints[i];
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
            outlinePath.lineTo(
              currPoint.x + prevPerpX * halfWidth,
              currPoint.y + prevPerpY * halfWidth
            );

            if (isOutsideCorner) {
              // For outside corners, just create a sharp corner rather than an arc
              outlinePath.lineTo(
                currPoint.x + currPerpX * halfWidth,
                currPoint.y + currPerpY * halfWidth
              );
            } else {
              // For inside corners, use a rounded joint with the arc
              // The arc direction is determined by the sign of the angle difference
              outlinePath.absarc(
                currPoint.x,
                currPoint.y,
                halfWidth,
                prevAngle,
                currAngle,
                angleDiff < 0
              );
            }
          } else {
            // If angles are similar, just continue with a line
            outlinePath.lineTo(
              currPoint.x + currPerpX * halfWidth,
              currPoint.y + currPerpY * halfWidth
            );
          }
        }

        // Add end cap (half circle)
        const lastPoint = allPoints[allPoints.length - 1];
        const lastPerpX = -perpXs[allPoints.length - 1];
        const lastPerpY = -perpYs[allPoints.length - 1];
        const endAngle = Math.atan2(lastPerpY, lastPerpX);

        outlinePath.absarc(
          lastPoint.x,
          lastPoint.y,
          halfWidth,
          endAngle,
          endAngle + Math.PI,
          false
        );

        // Add the left side of the path with rounded joints (going backwards)
        for (let i = allPoints.length - 2; i >= 0; i--) {
          const prevPoint = allPoints[i + 1];
          const currPoint = allPoints[i];
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
            outlinePath.lineTo(
              currPoint.x + prevPerpX * halfWidth,
              currPoint.y + prevPerpY * halfWidth
            );

            if (isOutsideCorner) {
              // For outside corners, just create a sharp corner rather than an arc
              outlinePath.lineTo(
                currPoint.x + currPerpX * halfWidth,
                currPoint.y + currPerpY * halfWidth
              );
            } else {
              // For inside corners, use a rounded joint with the arc
              // The arc direction is determined by the sign of the angle difference
              outlinePath.absarc(
                currPoint.x,
                currPoint.y,
                halfWidth,
                prevAngle,
                currAngle,
                angleDiff < 0
              );
            }
          } else {
            // If angles are similar, just continue with a line
            outlinePath.lineTo(
              currPoint.x + currPerpX * halfWidth,
              currPoint.y + currPerpY * halfWidth
            );
          }
        }

        // Close the path
        outlinePath.closePath();

        // Add the outline to the shape
        shape.add(outlinePath);

        // Create the shape geometry and store z-height in userData
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.userData = { zHeight: parseFloat(zHeight) };
        result[toolNumber].rapid.push(geometry);
      });
    });

    // Process cutting movements by grouping them by z-height
    const cuttingByZ = groupSegmentsByZ(segments.cutting);

    Object.entries(cuttingByZ).forEach(([zHeight, zSegments]) => {
      // Group connected segments to form continuous paths
      const connectedPaths = groupConnectedSegments(zSegments);

      // Process each connected path
      connectedPaths.forEach(pathSegments => {
        // Collect all points for the entire path
        let allPoints: THREE.Vector3[] = [];

        pathSegments.forEach(segment => {
          const segmentPoints = generateArcPoints(segment, segment.isArc ? 16 : 2);

          // If this is not the first segment, remove the first point to avoid duplication
          if (allPoints.length > 0 && segmentPoints.length > 0) {
            allPoints = allPoints.concat(segmentPoints.slice(1));
          } else {
            allPoints = allPoints.concat(segmentPoints);
          }
        });

        // Skip paths that are too short
        if (allPoints.length < 2) return;

        // Create a shape for this path using THREE.Shape
        const shape = new THREE.Shape();
        const path = new THREE.Path();

        // Calculate perpendicular vectors for each point
        const perpXs: number[] = [];
        const perpYs: number[] = [];

        // Calculate perpendicular vectors for each segment
        for (let i = 0; i < allPoints.length - 1; i++) {
          const p1 = allPoints[i];
          const p2 = allPoints[i + 1];
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

        // Create the outline path with rounded joints
        const outlinePath = new THREE.Path();

        // Start with a rounded cap at the beginning
        const firstPoint = allPoints[0];
        const firstPerpX = perpXs[0];
        const firstPerpY = perpYs[0];

        // Add starting cap (half circle)
        const startCapCenter = new THREE.Vector2(firstPoint.x, firstPoint.y);
        const startCapStart = new THREE.Vector2(
          firstPoint.x + firstPerpX * halfWidth,
          firstPoint.y + firstPerpY * halfWidth
        );
        const startAngle = Math.atan2(firstPerpY, firstPerpX);
        const startCapEnd = new THREE.Vector2(
          firstPoint.x - firstPerpX * halfWidth,
          firstPoint.y - firstPerpY * halfWidth
        );

        // Move to the start of the cap
        outlinePath.moveTo(startCapStart.x, startCapStart.y);

        // Add half-circle for the start cap
        outlinePath.absarc(
          startCapCenter.x,
          startCapCenter.y,
          halfWidth,
          startAngle,
          startAngle + Math.PI,
          false
        );

        // Add the right side of the path with rounded joints
        for (let i = 1; i < allPoints.length; i++) {
          const prevPoint = allPoints[i - 1];
          const currPoint = allPoints[i];
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
            outlinePath.lineTo(
              currPoint.x + prevPerpX * halfWidth,
              currPoint.y + prevPerpY * halfWidth
            );

            if (isOutsideCorner) {
              // For outside corners, just create a sharp corner rather than an arc
              outlinePath.lineTo(
                currPoint.x + currPerpX * halfWidth,
                currPoint.y + currPerpY * halfWidth
              );
            } else {
              // For inside corners, use a rounded joint with the arc
              // The arc direction is determined by the sign of the angle difference
              outlinePath.absarc(
                currPoint.x,
                currPoint.y,
                halfWidth,
                prevAngle,
                currAngle,
                angleDiff < 0
              );
            }
          } else {
            // If angles are similar, just continue with a line
            outlinePath.lineTo(
              currPoint.x + currPerpX * halfWidth,
              currPoint.y + currPerpY * halfWidth
            );
          }
        }

        // Add end cap (half circle)
        const lastPoint = allPoints[allPoints.length - 1];
        const lastPerpX = -perpXs[allPoints.length - 1];
        const lastPerpY = -perpYs[allPoints.length - 1];
        const endAngle = Math.atan2(lastPerpY, lastPerpX);

        outlinePath.absarc(
          lastPoint.x,
          lastPoint.y,
          halfWidth,
          endAngle,
          endAngle + Math.PI,
          false
        );

        // Add the left side of the path with rounded joints (going backwards)
        for (let i = allPoints.length - 2; i >= 0; i--) {
          const prevPoint = allPoints[i + 1];
          const currPoint = allPoints[i];
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
            outlinePath.lineTo(
              currPoint.x + prevPerpX * halfWidth,
              currPoint.y + prevPerpY * halfWidth
            );

            if (isOutsideCorner) {
              // For outside corners, just create a sharp corner rather than an arc
              outlinePath.lineTo(
                currPoint.x + currPerpX * halfWidth,
                currPoint.y + currPerpY * halfWidth
              );
            } else {
              // For inside corners, use a rounded joint with the arc
              // The arc direction is determined by the sign of the angle difference
              outlinePath.absarc(
                currPoint.x,
                currPoint.y,
                halfWidth,
                prevAngle,
                currAngle,
                angleDiff < 0
              );
            }
          } else {
            // If angles are similar, just continue with a line
            outlinePath.lineTo(
              currPoint.x + currPerpX * halfWidth,
              currPoint.y + currPerpY * halfWidth
            );
          }
        }

        // Close the path
        outlinePath.closePath();

        // Add the outline to the shape
        shape.add(outlinePath);

        // Create the shape geometry and store z-height in userData
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.userData = { zHeight: parseFloat(zHeight) };
        result[toolNumber].cutting.push(geometry);
      });
    });
  });

  return result;
}

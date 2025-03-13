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
 * Extract tool information from GCode comments
 */
export function extractToolsFromGCode(gcode: string): Record<string, Tool> {
  const toolsRegex = /[;(]\s*T(\d+)\s+D=(\d+(\.\d+)?)/g;
  const tools: Record<string, Tool> = {};
  let match;

  while ((match = toolsRegex.exec(gcode)) !== null) {
    const toolNumber = match[1];
    const diameter = parseFloat(match[2]);

    tools[toolNumber] = {
      number: parseInt(toolNumber, 10),
      diameter,
      // Assign different colors to different tools
      color: `hsl(${(parseInt(toolNumber, 10) * 137) % 360}, 70%, 50%)`,
    };
  }

  // Default tool if none found
  if (Object.keys(tools).length === 0) {
    tools['1'] = { number: 1, diameter: 6, color: 'hsl(0, 70%, 50%)' };
  }

  return tools;
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
 * Create THREE.Shape geometries for toolpath segments
 */
export function createToolpathGeometries(
  segmentsByTool: Record<number, { rapid: ToolpathSegment[]; cutting: ToolpathSegment[] }>,
  tools: Record<string, Tool>
): Record<string, { rapid: THREE.ShapeGeometry[]; cutting: THREE.ShapeGeometry[] }> {
  const result: Record<string, { rapid: THREE.ShapeGeometry[]; cutting: THREE.ShapeGeometry[] }> =
    {};

  Object.entries(segmentsByTool).forEach(([toolNumber, segments]) => {
    const tool = tools[toolNumber] || { diameter: 6 };
    const halfWidth = tool.diameter / 2;

    result[toolNumber] = {
      rapid: [],
      cutting: [],
    };

    // Process rapid movements by grouping them by z-height
    const rapidByZ = groupSegmentsByZ(segments.rapid);
    Object.entries(rapidByZ).forEach(([zHeight, zSegments]) => {
      // For each segment in this z-height, create a separate shape
      zSegments.forEach(segment => {
        const points = generateArcPoints(segment, segment.isArc ? 16 : 2);

        // Skip segments that are too short
        if (points.length < 2) return;

        // Create a shape for this path
        const shape = new THREE.Shape();

        // Calculate direction vector for the segment
        const p1 = points[0];
        const p2 = points[points.length - 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length <= 0) return;

        // Create a path with proper thickness
        const perpX = -dy / length;
        const perpY = dx / length;

        // Start with a straight segment
        const path = [];

        // Add points along one side
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          path.push(new THREE.Vector2(p.x + perpX * halfWidth, p.y + perpY * halfWidth));
        }

        // Go back along the other side
        for (let i = points.length - 1; i >= 0; i--) {
          const p = points[i];
          path.push(new THREE.Vector2(p.x - perpX * halfWidth, p.y - perpY * halfWidth));
        }

        // Create the shape
        shape.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          shape.lineTo(path[i].x, path[i].y);
        }
        shape.closePath();

        // Create the shape geometry and store z-height in userData
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.userData = { zHeight: parseFloat(zHeight) };
        result[toolNumber].rapid.push(geometry);
      });
    });

    // Process cutting movements by grouping them by z-height
    const cuttingByZ = groupSegmentsByZ(segments.cutting);
    Object.entries(cuttingByZ).forEach(([zHeight, zSegments]) => {
      // For each segment in this z-height, create a separate shape
      zSegments.forEach(segment => {
        const points = generateArcPoints(segment, segment.isArc ? 16 : 2);

        // Skip segments that are too short
        if (points.length < 2) return;

        // Create a shape for this path
        const shape = new THREE.Shape();

        // Calculate direction and perpendicular vectors
        const startIdx = 0;
        const endIdx = points.length - 1;
        const startPoint = points[startIdx];
        const endPoint = points[endIdx];

        // For arc segments, use more accurate direction calculation
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

        // Create path - first along one side
        const path = [];
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          path.push(new THREE.Vector2(p.x + perpXs[i] * halfWidth, p.y + perpYs[i] * halfWidth));
        }

        // Then back along the other side
        for (let i = points.length - 1; i >= 0; i--) {
          const p = points[i];
          path.push(new THREE.Vector2(p.x - perpXs[i] * halfWidth, p.y - perpYs[i] * halfWidth));
        }

        // Create the shape
        shape.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          shape.lineTo(path[i].x, path[i].y);
        }
        shape.closePath();

        // Create the shape geometry and store z-height in userData
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.userData = { zHeight: parseFloat(zHeight) };
        result[toolNumber].cutting.push(geometry);
      });
    });
  });

  return result;
}

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

/**
 * Pretty prints an OpenCV.js matrix in a readable format
 * @param mat - The OpenCV matrix to print
 * @param name - Optional name to display with the matrix
 * @param precision - Number of decimal places to display for floating point values
 * @returns The formatted string representation of the matrix
 */
function prettyPrintCvMat(
  mat: any, // Using any since OpenCV.js types aren't well-defined in TypeScript
  precision: number = 4
): string {
  // Check if mat is valid
  if (!mat || typeof mat.rows !== 'number' || typeof mat.cols !== 'number') {
    return 'Invalid matrix';
  }

  const name = 'Matrix';

  const rows = mat.rows;
  const cols = mat.cols;
  const channels = mat.channels();
  const depth = mat.depth();

  // Get the matrix type name
  const typeNames: Record<number, string> = {
    0: 'CV_8U', // CV_8U
    1: 'CV_8S', // CV_8S
    2: 'CV_16U', // CV_16U
    3: 'CV_16S', // CV_16S
    4: 'CV_32S', // CV_32S
    5: 'CV_32F', // CV_32F
    6: 'CV_64F', // CV_64F
    7: 'CV_16F', // CV_16F
  };

  const typeName = typeNames[depth] || `Unknown(${depth})`;
  const result: string[] = [`${name} (${rows}×${cols}, channels: ${channels}, type: ${typeName}):`];

  // Get data array based on matrix type
  let data: Uint8Array | Int8Array | Uint16Array | Int16Array | Int32Array | Float32Array | Float64Array;

  switch (depth) {
    case 0: // CV_8U
      data = mat.data;
      break;
    case 1: // CV_8S
      data = mat.data;
      break;
    case 2: // CV_16U
      data = mat.data16U;
      break;
    case 3: // CV_16S
      data = mat.data16S;
      break;
    case 4: // CV_32S
      data = mat.data32S;
      break;
    case 5: // CV_32F
      data = mat.data32F;
      break;
    case 6: // CV_64F
      data = mat.data64F;
      break;
    default:
      data = mat.data;
  }

  // Format number based on depth type
  const formatValue = (value: number): string => {
    if (depth === 5 || depth === 6) {
      // CV_32F or CV_64F
      return value.toFixed(precision);
    }
    return value.toString();
  };

  // Format each row
  for (let i = 0; i < rows; i++) {
    let rowStr = '  [';
    for (let j = 0; j < cols; j++) {
      if (channels === 1) {
        // Single channel
        const idx = i * cols + j;
        rowStr += formatValue(data[idx]);
      } else {
        // Multiple channels
        rowStr += '[';
        for (let c = 0; c < channels; c++) {
          const idx = i * cols * channels + j * channels + c;
          rowStr += formatValue(data[idx]);
          if (c < channels - 1) {
            rowStr += ', ';
          }
        }
        rowStr += ']';
      }

      // Add comma between column values
      if (j < cols - 1) {
        rowStr += ', ';
      }
    }
    rowStr += ']';

    // Add to result array
    result.push(rowStr);
  }

  return result.join('\n');
}

/**
 * Pretty prints a single point or vector from OpenCV
 * @param point - An OpenCV point or vector (cv.Point, cv.Point2f, etc.)
 * @param name - Optional name to display with the point
 * @param precision - Number of decimal places to display
 * @returns The formatted string representation of the point
 */
function prettyPrintCvPoint(point: any, precision: number = 4): string {
  const name = 'Point';

  if (!point) {
    return 'Invalid point';
  }

  // Format the coordinates with proper precision
  const format = (num: number): string => {
    if (typeof num === 'number' && !Number.isInteger(num)) {
      return num.toFixed(precision);
    }
    return num.toString();
  };

  // Handle 2D point
  if (typeof point.x === 'number' && typeof point.y === 'number' && point.z === undefined) {
    return `${name}: (${format(point.x)}, ${format(point.y)})`;
  }

  // Handle 3D point
  if (typeof point.x === 'number' && typeof point.y === 'number' && typeof point.z === 'number') {
    return `${name}: (${format(point.x)}, ${format(point.y)}, ${format(point.z)})`;
  }

  // Handle generic vector-like objects
  const props = Object.keys(point).filter(key => typeof point[key] === 'number');
  if (props.length > 0) {
    const values = props.map(prop => `${prop}: ${format(point[prop])}`);
    return `${name}: {${values.join(', ')}}`;
  }

  return 'Unsupported point/vector type';
}

// Combined function that handles both matrices and points
export function prettyPrintCv(obj: any, precision: number = 4): string {
  // Check if it's a matrix
  if (obj && typeof obj.rows === 'number' && typeof obj.cols === 'number') {
    return prettyPrintCvMat(obj, precision);
  }

  // Check if it's a point-like object
  if (obj && (typeof obj.x === 'number' || typeof obj.y === 'number')) {
    return prettyPrintCvPoint(obj, precision);
  }

  return 'Unsupported OpenCV object type';
}

// Example usage:
/*
import cv from '@techstark/opencv-js';
import { ensureOpenCvIsLoaded } from '@/lib/loadOpenCv';

// Ensure OpenCV is loaded
await ensureOpenCvIsLoaded();

// Create a matrix and print it
const mat = new cv.Mat(3, 3, cv.CV_32F);
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) {
    mat.floatPtr(i, j)[0] = i * 3 + j + 0.5;
  }
}
console.log(prettyPrintCv(mat, 'My Matrix'));

// Create a point and print it
const point = new cv.Point(10, 20);
console.log(prettyPrintCv(point, 'My Point'));

// Don't forget to clean up
mat.delete();
*/

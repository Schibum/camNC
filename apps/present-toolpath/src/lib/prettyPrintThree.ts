import { Matrix3, Matrix4, Vector2, Vector3, Vector4 } from 'three';

/**
 * Type guards to check the type of Three.js objects
 */
function isMatrix3(obj: any): obj is Matrix3 {
  return obj && obj.elements && obj.elements.length === 9;
}

function isMatrix4(obj: any): obj is Matrix4 {
  return obj && obj.elements && obj.elements.length === 16;
}

function isVector2(obj: any): obj is Vector2 {
  return obj && typeof obj.x === 'number' && typeof obj.y === 'number' && obj.z === undefined;
}

function isVector3(obj: any): obj is Vector3 {
  return obj && typeof obj.x === 'number' && typeof obj.y === 'number' && typeof obj.z === 'number' && obj.w === undefined;
}

function isVector4(obj: any): obj is Vector4 {
  return obj && typeof obj.x === 'number' && typeof obj.y === 'number' && typeof obj.z === 'number' && typeof obj.w === 'number';
}

/**
 * Pretty prints a Three.js Matrix or Vector in a readable format
 * @param obj - The Three.js object to print (Matrix3, Matrix4, Vector2, Vector3, Vector4)
 * @param name - Optional name to display with the object
 * @param precision - Number of decimal places to display
 * @returns The formatted string representation of the object
 */
export function prettyPrintThree(
  obj: Matrix3 | Matrix4 | Vector2 | Vector3 | Vector4,
  name: string = 'Object',
  precision: number = 4
): string {
  if (!obj) {
    return 'Invalid object';
  }

  // Format a number with the specified precision
  const format = (num: number): string => num.toFixed(precision);

  // Handle Vector2
  if (isVector2(obj)) {
    return `${name} (Vector2): [${format(obj.x)}, ${format(obj.y)}]`;
  }

  // Handle Vector3
  if (isVector3(obj)) {
    return `${name} (Vector3): [${format(obj.x)}, ${format(obj.y)}, ${format(obj.z)}]`;
  }

  // Handle Vector4
  if (isVector4(obj)) {
    return `${name} (Vector4): [${format(obj.x)}, ${format(obj.y)}, ${format(obj.z)}, ${format(obj.w)}]`;
  }

  // Handle Matrix3
  if (isMatrix3(obj)) {
    let result = `${name} (Matrix3):\n`;
    for (let i = 0; i < 3; i++) {
      result += '  [';
      for (let j = 0; j < 3; j++) {
        // Three.js matrices are stored in column-major order
        const index = j * 3 + i;
        result += format(obj.elements[index]);
        if (j < 2) result += ', ';
      }
      result += ']';
      if (i < 2) result += '\n';
    }
    return result;
  }

  // Handle Matrix4
  if (isMatrix4(obj)) {
    let result = `${name} (Matrix4):\n`;
    for (let i = 0; i < 4; i++) {
      result += '  [';
      for (let j = 0; j < 4; j++) {
        // Three.js matrices are stored in column-major order
        const index = j * 4 + i;
        result += format(obj.elements[index]);
        if (j < 3) result += ', ';
      }
      result += ']';
      if (i < 3) result += '\n';
    }
    return result;
  }

  return 'Unsupported object type';
}

// Example usage:
// import { Matrix3, Matrix4, Vector2, Vector3, Vector4 } from 'three';
//
// // Vector examples
// const vec2 = new Vector2(1.2345, 2.3456);
// console.log(prettyPrintThree(vec2, 'Position2D'));
//
// const vec3 = new Vector3(1.2345, 2.3456, 3.4567);
// console.log(prettyPrintThree(vec3, 'Position3D'));
//
// const vec4 = new Vector4(1.2345, 2.3456, 3.4567, 4.5678);
// console.log(prettyPrintThree(vec4, 'Quaternion'));
//
// // Matrix examples
// const mat3 = new Matrix3().set(
//   1.1111, 2.2222, 3.3333,
//   4.4444, 5.5555, 6.6666,
//   7.7777, 8.8888, 9.9999
// );
// console.log(prettyPrintThree(mat3, 'Rotation'));
//
// const mat4 = new Matrix4().set(
//   1.1111, 2.2222, 3.3333, 4.4444,
//   5.5555, 6.6666, 7.7777, 8.8888,
//   9.9999, 10.1010, 11.1111, 12.1212,
//   13.1313, 14.1414, 15.1515, 16.1616
// );
// console.log(prettyPrintThree(mat4, 'Transform'));

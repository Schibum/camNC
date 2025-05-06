import { Matrix3 } from 'three';

export type Array9 = [number, number, number, number, number, number, number, number, number];

export function matrix3ToRowMajor(matrix: Matrix3): Array9 {
  const elements = matrix.elements;
  // prettier-ignore
  return [
    elements[0], elements[3], elements[6], // First row
    elements[1], elements[4], elements[7], // Second row
    elements[2], elements[5], elements[8]  // Third row
  ];
}

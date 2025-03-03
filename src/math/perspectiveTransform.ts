// ----- Utility: Solve 3x3 Homography from 4 correspondences -----
export function computeHomography(
  src: [number, number][],
  dst: [number, number][] ): number[] {
  // We'll get the 9 entries: h00..h21, with h22=1
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [X, Y] = dst[i];
    // X*(h20*x + h21*y +1) = h00*x + h01*y + h02
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    B.push(X);
    // Y*(h20*x + h21*y +1) = h10*x + h11*y + h12
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    B.push(Y);
  }

  const h = solve8x8(A, B);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function solve8x8(A: number[][], b: number[]) {
  const n = 8;
  A = A.map(r => r.slice());
  b = b.slice();

  for (let i = 0; i < n; i++) {
    // pivot
    let pivotRow = i;
    let maxVal = Math.abs(A[i][i]);
    for (let r = i + 1; r < n; r++) {
      const val = Math.abs(A[r][i]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }
    if (pivotRow !== i) {
      [A[i], A[pivotRow]] = [A[pivotRow], A[i]];
      [b[i], b[pivotRow]] = [b[pivotRow], b[i]];
    }
    // eliminate below
    for (let r = i + 1; r < n; r++) {
      const factor = A[r][i] / A[i][i];
      b[r] -= factor * b[i];
      for (let c = i; c < n; c++) {
        A[r][c] -= factor * A[i][c];
      }
    }
  }

  // back-substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let c = i + 1; c < n; c++) {
      sum -= A[i][c] * x[c];
    }
    x[i] = sum / A[i][i];
  }
  return x;
}
// ----- Utility: Embed 3x3 H in a 4x4 matrix for Three.js -----
export function buildMatrix4FromHomography(H: number[]) {
  // H = [h00,h01,h02, h10,h11,h12, h20,h21,h22]
  // We embed in a 4x4:
  //  [ h00 h01  0  h02 ]
  //  [ h10 h11  0  h12 ]
  //  [  0   0   1   0  ]
  //  [ h20 h21  0  h22 ]
  //
  // But recall that Three.js uses column-major order in memory. We'll
  // build an array in row-major order, then pass to fromArray(...).
  // So the array indices match:
  //
  //   m[ 0] m[ 4] m[ 8]  m[12]
  //   m[ 1] m[ 5] m[ 9]  m[13]
  //   m[ 2] m[ 6] m[10] m[14]
  //   m[ 3] m[ 7] m[11] m[15]
  //
  // => row i, column j => m[j*4 + i]
  const h00 = H[0], h01 = H[1], h02 = H[2];
  const h10 = H[3], h11 = H[4], h12 = H[5];
  const h20 = H[6], h21 = H[7], h22 = H[8];

  // row-major:
  return [
    h00, h10, 0, h20,
    h01, h11, 0, h21,
    0, 0, 1, 0,
    h02, h12, 0, h22
  ];
}

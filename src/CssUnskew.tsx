import React, { useEffect, useState } from 'react';

/** Props for our CSS transform approach */
interface CssUnskewProps {
  /** The URL of the image to unskew */
  imageUrl: string;

  /**
   * The four corners of the source region in the image,
   * in the order: top-left, top-right, bottom-right, bottom-left,
   * e.g. [ [x0,y0], [x1,y1], [x2,y2], [x3,y3] ].
   */
  srcPoints?: [number, number][];

  /**
   * The four destination corners, in the same order,
   * e.g. [ [X0,Y0], [X1,Y1], [X2,Y2], [X3,Y3] ].
   */
  dstPoints?: [number, number][];

  /**
   * The original (full) image size in pixels [width, height].
   * This should match how the <img> is displayed (e.g. `img`'s natural size).
   * If you scale the <img>, adjust accordingly or do the same scaling in the transform.
   */
  imageSize?: [number, number];
}

/**
 * A React component that unskews (applies a perspective transform)
 * to an <img> using only CSS3 transforms (`matrix3d`).
 *
 * - We compute a 3x3 homography from `srcPoints` -> `dstPoints`
 * - Embed that in a 4x4 matrix for `matrix3d`
 * - Apply it via inline style
 *
 * Requirements:
 * - The <img> is absolutely positioned at (0,0), with transform-origin: top-left
 *   so the transform is anchored at the top-left corner.
 */
export const CssUnskewedImage: React.FC<CssUnskewProps> = ({
  imageUrl,
  srcPoints = [
    [480, 700],    // top-left
    [1655, 950],   // top-right
    [2173, 3251],  // bottom-right
    [105, 3388]    // bottom-left
  ],
  dstPoints = [
    [0, 0],       // top-left
    [625, 0],     // top-right
    [625, 1235],  // bottom-right
    [0, 1235]     // bottom-left
  ],
  imageSize = [3070, 4080]
}) => {
  const [transformString, setTransformString] = useState<string>("none");

  useEffect(() => {
    // We’ll compute the homography H and build the matrix3d string once the
    // component mounts or props change.

    function solveHomography(
      src: [number, number][],
      dst: [number, number][]
    ): number[] {
      // Solve for 8 unknowns in the 3x3 (with h22 = 1)
      const A: number[][] = [];
      const B: number[] = [];

      for (let i = 0; i < 4; i++) {
        const [x, y] = src[i];
        const [X, Y] = dst[i];

        // X * (h20*x + h21*y + 1) = h00*x + h01*y + h02
        // => h00*x + h01*y + h02 - X*h20*x - X*h21*y - X = 0
        A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
        B.push(X);

        // Y * (h20*x + h21*y + 1) = h10*x + h11*y + h12
        // => h10*x + h11*y + h12 - Y*h20*x - Y*h21*y - Y = 0
        A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
        B.push(Y);
      }

      const h = solve8x8(A, B);
      return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
    }

    function solve8x8(A: number[][], b: number[]): number[] {
      const n = 8;
      A = A.map(r => r.slice());
      b = b.slice();

      // Gaussian elimination
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

    function buildMatrix3dFromH(H: number[]) {
      // H is [h00, h01, h02, h10, h11, h12, h20, h21, h22].
      // We embed it in a 4x4 for CSS (column-major).
      //
      // According to the CSS spec for matrix3d(a1,b1,c1,d1, a2,b2,c2,d2, ...),
      // the 4x4 matrix is:
      //
      // [ a1 a2 a3 a4 ]
      // [ b1 b2 b3 b4 ]
      // [ c1 c2 c3 c4 ]
      // [ d1 d2 d3 d4 ]
      //
      // We want:
      // [ h00  h01  0   h02 ]
      // [ h10  h11  0   h12 ]
      // [ 0    0    1   0   ]
      // [ h20  h21  0   h22 ]
      //
      // That means:
      // a1 = h00, a2 = h01, a3=0, a4=h02,
      // b1 = h10, b2 = h11, b3=0, b4=h12,
      // c1=0, c2=0, c3=1, c4=0,
      // d1=h20, d2=h21, d3=0, d4=h22.
      //
      // So the final array is:
      // [ h00, h10, 0, h20,
      //   h01, h11, 0, h21,
      //   0,    0,   1, 0,
      //   h02, h12, 0, h22 ]
      //
      // But that's transposed from the usual row-major approach. We must be sure
      // to fill in the arguments in the order that CSS expects (which is row-major
      // in the final visual layout, but the function signature lumps columns).
      //
      // Carefully following the doc, the correct order in `matrix3d(a1,b1,c1,d1,a2,b2,c2,d2,...)` is:
      //   a1 = m11 = h00
      //   b1 = m12 = h10
      //   c1 = m13 = 0
      //   d1 = m14 = h20
      //   a2 = m21 = h01
      //   b2 = m22 = h11
      //   c2 = m23 = 0
      //   d2 = m24 = h21
      //   a3 = m31 = 0
      //   b3 = m32 = 0
      //   c3 = m33 = 1
      //   d3 = m34 = 0
      //   a4 = m41 = h02
      //   b4 = m42 = h12
      //   c4 = m43 = 0
      //   d4 = m44 = h22
      //
      // So the array is:
      const h00 = H[0], h01 = H[1], h02 = H[2];
      const h10 = H[3], h11 = H[4], h12 = H[5];
      const h20 = H[6], h21 = H[7], h22 = H[8];

      // Format them into the matrix3d(...) string
      return `matrix3d(
        ${h00}, ${h10}, 0, ${h20},
        ${h01}, ${h11}, 0, ${h21},
        0, 0, 1, 0,
        ${h02}, ${h12}, 0, ${h22}
      )`;
    }

    // 1) compute 3x3 homography
    const H = solveHomography(srcPoints, dstPoints);
    console.log('H css', H)

    // 2) build matrix3d() string
    const matStr = buildMatrix3dFromH(H);

    // 3) update state
    setTransformString(matStr);
  }, [imageUrl, srcPoints, dstPoints, imageSize]);

  // We ensure the image is displayed at its natural size or the known `imageSize`.
  // Then the CSS transform can “distort” it to the final shape.
  const [width, height] = imageSize;

  // We'll absolutely position the image at (0,0), anchor transform at (0,0).
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '625px',
    height: '1235px',
    overflow: 'hidden',    // ensures we only see the portion inside
    border: '1px solid #ccc' // optional, just to visualize
  };

  const imgStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: '0 0',
    transform: transformString,
    // ensure the <img> is drawn at (width x height),
    // if the image isn't automatically that size:
    width,
    height
  };

  return (
    <div style={containerStyle}>
      <img src={imageUrl} alt="" style={imgStyle} />
    </div>
  );
};

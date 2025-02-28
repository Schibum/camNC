import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

type UnskewNoUVProps = {
  /** URL of the image we want to display */
  imageUrl: string;

  /**
   * The source corner coords (4 points) in the image
   * coordinate space, e.g. [ [x0,y0], [x1,y1], ... ].
   * Order: top-left, top-right, bottom-right, bottom-left.
   */
  srcPoints?: [number, number][];

  /**
   * The destination coords (4 points) in the final space,
   * same corner order. That might be e.g. [ [0,0],[625,0],[625,1235],[0,1235] ]
   */
  dstPoints?: [number, number][];

  /** The image’s full size, e.g. [3070, 4080]. */
  imageSize?: [number, number];

  /**
   * The width and height of the final rendered canvas
   * if you want it clipped or specifically sized.
   * Default is [1000, 1000].
   */
  renderSize?: [number, number];
};

/**
 * A React + Three.js component that:
 * 1) Loads an image as a texture
 * 2) Creates a single PlaneGeometry covering [0..imgWidth] x [0..imgHeight]
 * 3) Computes a 3x3 homography from srcPoints -> dstPoints
 * 4) Embeds that 3x3 into a 4x4 matrix
 * 5) Applies that matrix to the entire geometry so the plane is physically
 *    “unskewed” in 3D space (no extra UV / tessellation).
 */
export const UnskewThree: React.FC<UnskewNoUVProps> = ({
  imageUrl,
  srcPoints = [
    [480, 700],    // top-left
    [1655, 950],   // top-right
    [2173, 3251],  // bottom-right
    [105, 3388]    // bottom-left
  ],
  dstPoints = [
    [0, 0],        // top-left
    [625, 0],      // top-right
    [625, 1235],   // bottom-right
    [0, 1235]      // bottom-left
  ],
  imageSize = [3070, 4080],
  renderSize = [625, 1235]
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    const [imgWidth, imgHeight] = imageSize;
    const [canvasW, canvasH] = renderSize;

    // ------ 1) Create Scene & OrthographicCamera ------
    const scene = new THREE.Scene();
    // We'll just define an Ortho camera from (0,0) to (canvasW, canvasH).
    // That way, if your dstPoints also lie in e.g. [0..625, 0..1235],
    // you can see them in that region.
    const camera = new THREE.OrthographicCamera(
      0, canvasW,
      0, canvasH,
      -1000, 1000
    );
    camera.position.z = 10;

    // Create the renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(canvasW, canvasH);
    containerRef.current.appendChild(renderer.domElement);

    // ------ 2) PlaneGeometry covers [0..imgWidth] x [0..imgHeight] in local coords ------
    // So corner (0,0) is the top-left in local space, (imgWidth,imgHeight) is bottom-right.
    // We'll do 1 segment, so there's only 2 triangles. No extra tesselation.
    const planeGeom = new THREE.PlaneGeometry(imgWidth, imgHeight, 1, 1);

    // By default, PlaneGeometry is centered at (0,0). Let's shift it so the
    // top-left is at local (0,0) instead, if we want:
    // We can do that by translating the geometry's vertices:
    planeGeom.translate(imgWidth / 2, imgHeight / 2, 0);
    // Actually, that puts the plane center at (imgWidth/2, imgHeight/2).
    // Another approach: we create a custom geometry. For brevity, let's keep it
    // standard plane, but note it starts centered. Not crucial.

    // ------ 3) Create the Mesh with a basic texture ------
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(imageUrl, (texture) => {
      texture.flipY = false;

      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(planeGeom, material);
      scene.add(mesh);

      // ------ 4) Compute the 3x3 homography & embed in a 4x4 matrix, apply it to the mesh ------
      const H = computeHomography(srcPoints, dstPoints);
      const M = buildMatrix4FromHomography(H);

      // We can load it into mesh.matrix, then disable auto‐update:
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(M);

      // Render once
      renderer.render(scene, camera);
    });

    // Cleanup
    return () => {
      renderer.dispose();
      planeGeom.dispose();
      scene.clear();
    };
  }, [imageUrl, srcPoints, dstPoints, imageSize, renderSize]);

  return <div ref={containerRef} />;
};

// ----- Utility: Solve 3x3 Homography from 4 correspondences -----
function computeHomography(
  src: [number, number][],
  dst: [number, number][]
): number[] {
  // We'll get the 9 entries: h00..h21, with h22=1
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [X, Y] = dst[i];
    // X*(h20*x + h21*y +1) = h00*x + h01*y + h02
    A.push([ x, y, 1, 0, 0, 0, -X*x, -X*y ]);
    B.push(X);
    // Y*(h20*x + h21*y +1) = h10*x + h11*y + h12
    A.push([ 0, 0, 0, x, y, 1, -Y*x, -Y*y ]);
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
    for (let r = i+1; r < n; r++) {
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
    for (let r = i+1; r < n; r++) {
      const factor = A[r][i] / A[i][i];
      b[r] -= factor * b[i];
      for (let c = i; c < n; c++) {
        A[r][c] -= factor * A[i][c];
      }
    }
  }

  // back-substitution
  const x = new Array(n).fill(0);
  for (let i = n-1; i >= 0; i--) {
    let sum = b[i];
    for (let c = i+1; c < n; c++) {
      sum -= A[i][c] * x[c];
    }
    x[i] = sum / A[i][i];
  }
  return x;
}

// ----- Utility: Embed 3x3 H in a 4x4 matrix for Three.js -----
function buildMatrix4FromHomography(H: number[]) {
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
    0,   0,   1, 0,
    h02, h12, 0, h22
  ];
}

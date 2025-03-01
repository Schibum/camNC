import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeHomography, buildMatrix4FromHomography } from './math/perspectiveTransform';

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

  /** The image's full size, e.g. [3070, 4080]. */
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
 *    "unskewed" in 3D space (no extra UV / tessellation).
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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);

    // Add OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false; // Disable rotation since we only want pan and zoom
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    controls.enableDamping = true; // Add smooth damping effect
    controls.dampingFactor = 0.25;

    // Limit zoom
    controls.minZoom = 1; // Can't zoom out beyond initial view
    controls.maxZoom = 10; // Can zoom in up to 10x

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
      texture.colorSpace = THREE.SRGBColorSpace;

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

      // Set up animation loop instead of single render
      function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }

      // Start animation loop
      animate();
    });

    // Cleanup
    return () => {
      renderer.dispose();
      planeGeom.dispose();
      controls.dispose(); // Clean up controls
      scene.clear();
    };
  }, [imageUrl, srcPoints, dstPoints, imageSize, renderSize]);

  return <div ref={containerRef} />;
};



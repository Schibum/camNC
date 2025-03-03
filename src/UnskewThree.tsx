import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeHomography, buildMatrix4FromHomography } from './math/perspectiveTransform';
import { useAtomValue } from 'jotai';
import { cameraConfigAtom, IBox } from './atoms';


/**
 * A React + Three.js component that:
 * 1) Loads a video as a texture
 * 2) Creates a single PlaneGeometry covering [0..videoWidth] x [0..videoHeight]
 * 3) Computes a 3x3 homography from srcPoints -> dstPoints
 * 4) Embeds that 3x3 into a 4x4 matrix
 * 5) Applies that matrix to the entire geometry so the plane is physically
 *    "unskewed" in 3D space (no extra UV / tessellation).
 */
export const UnskewThree: React.FC<{}> = ({
  // videoUrl,
  // srcPoints = [
  //   [480, 700],    // top-left
  //   [1655, 950],   // top-right
  //   [2173, 3251],  // bottom-right
  //   [105, 3388]    // bottom-left
  // ],
  // dstPoints = [
  //   [0, 0],        // top-left
  //   [625, 0],      // top-right
  //   [625, 1235],   // bottom-right
  //   [0, 1235]      // bottom-left
  // ],
  // imageSize = [3070, 4080],
  // renderSize = [625, 1235]
}) => {
  const camConfig = useAtomValue(cameraConfigAtom);
  if (!camConfig) throw new Error('Camera config not found');
  // console.log('videoUrl', videoUrl, srcPoints, dstPoints, imageSize, renderSize);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    const [imgWidth, imgHeight] = camConfig.dimensions;
    const renderSize = [camConfig.machineBounds[1][0] - camConfig.machineBounds[0][0], camConfig.machineBounds[1][1] - camConfig.machineBounds[0][1]];
    const [canvasW, canvasH] = renderSize;

    // Create video element
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = camConfig.url;
    video.muted = true;
    video.playsInline = true;
    videoRef.current = video;

    // ------ 1) Create Scene & OrthographicCamera ------
    const scene = new THREE.Scene();
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
    controls.enableRotate = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.minZoom = 1;
    controls.maxZoom = 10;

    // ------ 2) PlaneGeometry covers [0..imgWidth] x [0..imgHeight] in local coords ------
    const planeGeom = new THREE.PlaneGeometry(imgWidth, imgHeight, 1, 1);
    planeGeom.translate(imgWidth / 2, imgHeight / 2, 0);

    // ------ 3) Create the Mesh with video texture ------
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.flipY = false;

    const material = new THREE.MeshBasicMaterial({
      map: videoTexture,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(planeGeom, material);
    scene.add(mesh);

    // ------ 4) Compute the 3x3 homography & embed in a 4x4 matrix, apply it to the mesh ------

    const mp = camConfig.machineBounds;
    const dstPoints = [[mp[0][0], mp[0][1]], [mp[1][0], mp[0][1]], [mp[1][0], mp[1][1]], [mp[0][0], mp[1][1]]] as IBox;
    const H = computeHomography(camConfig.machineBoundsInCam, dstPoints);
    const M = buildMatrix4FromHomography(H);

    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(M);

    // Start video playback
    video.play().catch(console.error);

    // Set up animation loop
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }

    // Start animation loop
    animate();

    // Cleanup
    return () => {
      video.pause();
      video.src = '';
      video.load();
      renderer.dispose();
      planeGeom.dispose();
      material.dispose();
      videoTexture.dispose();
      controls.dispose();
      scene.clear();
    };
  }, [
    camConfig
  ]);

  return <div ref={containerRef} />;
};



import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Helper function to create a rounded rectangle shape
const createRoundedRectShape = (width: number, height: number, radius: number) => {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2 + radius, -height / 2);
  shape.lineTo(width / 2 - radius, -height / 2);
  shape.quadraticCurveTo(width / 2, -height / 2, width / 2, -height / 2 + radius);
  shape.lineTo(width / 2, height / 2 - radius);
  shape.quadraticCurveTo(width / 2, height / 2, width / 2 - radius, height / 2);
  shape.lineTo(-width / 2 + radius, height / 2);
  shape.quadraticCurveTo(-width / 2, height / 2, -width / 2, height / 2 - radius);
  shape.lineTo(-width / 2, -height / 2 + radius);
  shape.quadraticCurveTo(-width / 2, -height / 2, -width / 2 + radius, -height / 2);
  return shape;
};

// Helper function to create a parallelogram geometry
const createParallelogramGeometry = (width: number, height: number) => {
  const shape = new THREE.Shape();
  const skew = width * 0.2; // 20% skew
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const uvs = new Float32Array([
    0, 0,  // bottom-left
    1, 0,  // bottom-right
    1, 1,  // top-right
    0, 1   // top-left
  ]);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geometry;
};

export function PulsingRectangle({ backgroundImage = 'present-toolpath/table.jpg' }) {
  const mountRef = useRef(null);
  const [coordinates, setCoordinates] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
      -window.innerWidth / 2,
      window.innerWidth / 2,
      window.innerHeight / 2,
      -window.innerHeight / 2,
      1,
      1000
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    // Initialize OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false; // Disable rotation since we're working in 2D
    controls.screenSpacePanning = true; // Enable proper panning in orthographic mode
    controls.minZoom = 0.9; // Allow zooming out to 10% of original size
    controls.maxZoom = 10; // Allow zooming in to 1000% of original size
    controls.enableDamping = true; // Add smooth damping effect
    controls.dampingFactor = 0.1;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
    controls.panSpeed = 1.5; // Adjust pan sensitivity
    controls.enablePan = true; // Explicitly enable panning
    // var minPan = new THREE.Vector3(-window.innerWidth / 4, -window.innerHeight / 4, -5);
    // var maxPan = new THREE.Vector3(window.innerWidth / 4, window.innerHeight / 4, 5);
    // var _v = new THREE.Vector3();

    // controls.addEventListener("change", function () {
    //   _v.copy(controls.target);
    //   controls.target.clamp(minPan, maxPan);
    //   _v.sub(controls.target);
    //   camera.position.sub(_v);
    // })

    // Add background image
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(backgroundImage, (texture) => {
      const aspectRatio = texture.image.width / texture.image.height;
      const screenAspectRatio = window.innerWidth / window.innerHeight;

      // Calculate dimensions to fit within the camera's view
      let bgWidth, bgHeight;

      if (aspectRatio > screenAspectRatio) {
        bgWidth = window.innerWidth;
        bgHeight = window.innerWidth / aspectRatio;
      } else {
        bgHeight = window.innerHeight;
        bgWidth = window.innerHeight * aspectRatio;
      }

      const bgGeometry = createParallelogramGeometry(bgWidth, bgHeight);
      const bgMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        depthWrite: false,
      });
      const background = new THREE.Mesh(bgGeometry, bgMaterial);
      background.position.z = -1;
      scene.add(background);

      // Add click detection
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const onClick = (event: MouseEvent) => {
        // Calculate mouse position in normalized device coordinates (-1 to +1)
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(background);

        if (intersects.length > 0) {
          const point = intersects[0].point;
          setCoordinates({ x: Math.round(point.x), y: Math.round(point.y) });
        }
      };

      renderer.domElement.addEventListener('click', onClick);

      // Update cleanup function to remove event listener
      const originalCleanup = mountRef.current.__cleanup;
      mountRef.current.__cleanup = () => {
        originalCleanup?.();
        renderer.domElement.removeEventListener('click', onClick);
      };
    });

    const width = 200;
    const height = 100;
    const radius = 10;

    // Create main rectangle
    const geometry = new THREE.ShapeGeometry(createRoundedRectShape(width, height, radius));
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const rectangle = new THREE.Mesh(geometry, material);

    // Create outline
    const outlineGeometry = new THREE.ShapeGeometry(createRoundedRectShape(width + 10, height + 10, radius + 5));
    const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
    outline.position.z = -0.1;
    rectangle.add(outline);

    // Position rectangle in standard Three.js coordinates (centered by default)
    rectangle.position.set(-150, 0, 0);
    scene.add(rectangle);

    const axesHelper = new THREE.AxesHelper(50);
    scene.add(axesHelper);

    const clock = new THREE.Clock();

    const animate = () => {
      requestAnimationFrame(animate);
      const newPulse = Math.sin(clock.getElapsedTime() * 2.5) * 0.5 + 1;
      rectangle.scale.set(newPulse, newPulse, 1);

      // Animate using standard coordinates
      rectangle.position.x = -150 + (50 * Math.sin(clock.getElapsedTime() * 2.5));

      rectangle.rotateZ(newPulse * 0.01);
      controls.update(); // Update controls in animation loop
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      camera.left = -window.innerWidth / 2;
      camera.right = window.innerWidth / 2;
      camera.top = window.innerHeight / 2;
      camera.bottom = -window.innerHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      controls.update(); // Update controls when window is resized
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      mountRef.current.__cleanup?.();
      mountRef.current.removeChild(renderer.domElement);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return (
    <>
      <div ref={mountRef} style={{ width: '100vw', height: '100vh', position: 'fixed', top: '0', left: '0' }} />
      {coordinates && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '20px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '10px',
          borderRadius: '5px',
          fontFamily: 'monospace'
        }}>
          X: {coordinates.x}, Y: {coordinates.y}
        </div>
      )}
    </>
  );
}

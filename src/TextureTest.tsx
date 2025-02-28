import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface TextureTestProps {
  imageUrl: string;
}

export function TextureTest({ imageUrl }: TextureTestProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Set up scene
    const scene = new THREE.Scene();
    const [canvasWidth, canvasHeight] = [containerRef.current.clientWidth, containerRef.current.clientHeight];

    const camera = new THREE.OrthographicCamera(
      0,              // left
      1,    // right
      0,              // top
      -1,   // bottom
      1,
      1000
    );
    camera.position.z = 5;
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);

    // Create plane with texture
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(imageUrl);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);

    // Position camera
    camera.position.z = 2;

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    // Cleanup
    return () => {
      containerRef.current?.removeChild(renderer.domElement);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
    };
  }, [imageUrl]);

  return <div ref={containerRef} style={{ width: '100%', height: '400px' }} />;
}

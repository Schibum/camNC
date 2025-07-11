import { useThree } from '@react-three/fiber';
import { useGesture } from '@use-gesture/react';
import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
interface DraggableProps {
  children: React.ReactNode;
  onDragStart?: (event: ThreeEvent<PointerEvent>) => void;
  onDragEnd?: (event: ThreeEvent<PointerEvent>) => void;
  [key: string]: any;
}

// Hack: ignore events that are used for orbitControl panning
function isOrbitPan(event: ThreeEvent<PointerEvent>) {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

export function Draggable({ children, onDragStart = undefined, onDragEnd = undefined, ...props }: DraggableProps) {
  const ref = useRef<THREE.Group>(null);
  const { raycaster, size, camera } = useThree();
  const isDragging = useRef(false);
  const { mouse2D, mouse3D, offset, normal, plane } = useMemo(
    () => ({
      mouse2D: new THREE.Vector2(), // Normalized 2D screen space mouse coords
      mouse3D: new THREE.Vector3(), // 3D world space mouse coords
      offset: new THREE.Vector3(), // Drag point offset from object origin
      normal: new THREE.Vector3(), // Normal of the drag plane
      plane: new THREE.Plane(), // Drag plane
    }),
    []
  );
  const bind = useGesture<{ drag: ThreeEvent<PointerEvent> }>(
    {
      onDrag: ({ xy: [x, y], event, tap }) => {
        if (tap || !isDragging.current) return;
        // Compute normalized mouse coordinates (screen space)
        event.stopPropagation();
        // Compute normalized mouse coordinates (screen space)
        const nx = ((x - size.left) / size.width) * 2 - 1;
        const ny = -((y - size.top) / size.height) * 2 + 1;
        // Unlike the mouse from useThree, this works offscreen
        mouse2D.set(nx, ny);

        // Update raycaster (otherwise it doesn't track offscreen)
        raycaster.setFromCamera(mouse2D, camera);

        // The drag plane is normal to the camera view
        camera.getWorldDirection(normal).negate();

        // Find the plane that's normal to the camera and contains our drag point
        plane.setFromNormalAndCoplanarPoint(normal, mouse3D);

        // Find the point of intersection
        raycaster.ray.intersectPlane(plane, mouse3D);

        // Update the object position with the original offset
        ref.current?.position.copy(mouse3D).add(offset);
      },
      onDragStart: ({ event }) => {
        if (isOrbitPan(event)) return;
        event.stopPropagation();
        isDragging.current = true;
        const { eventObject, point } = event as any;

        // Save the offset of click point from object origin
        eventObject.getWorldPosition(offset).sub(point);

        // Set initial 3D cursor position (needed for onDrag plane calculation)
        mouse3D.copy(point);

        // Run user callback
        if (onDragStart) onDragStart(event);
      },
      onDragEnd: ({ event }) => {
        event.stopPropagation();
        isDragging.current = false;
        if (onDragEnd) onDragEnd(event);
      },
      // onClick: (ev) => {
      //   ev.stopPropagation();
      // },
    },

    {
      drag: {
        filterTaps: true,
      },
    }
  );

  return (
    <group ref={ref} {...bind()} {...props}>
      {children}
    </group>
  );
}

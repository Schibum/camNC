import { getCncApi } from '@/lib/fluidnc/fluidnc-singleton';
import { useShowMachinePosMarker, useToolDiameter } from '@/store/store';
import { animated, easings, useSpring } from '@react-spring/three';
import { Line } from '@react-three/drei';
import { useMemo } from 'react';

/**
 * MachinePositionMarker renders an animated marker at the current
 * machine position (mpos) reported by FluidNC.  It consists of a pulsing
 * ring matching the tool diameter and a thin cross through the centre.
 */
export function MachinePositionMarker({
  opacity = 0.7,
  innerColor = '#ffff00',
  dashColor = '#ff00ff',
}: {
  opacity?: number;
  innerColor?: string;
  dashColor?: string;
}) {
  'use no memo';

  const visible = useShowMachinePosMarker();

  // Access CNC API & reactive machine position.
  const cncApi = getCncApi();
  const mpos = cncApi.machinePos.value; // {x,y,z}

  // Radius = ½ tool diameter.
  const toolDiameter = useToolDiameter();
  const radius = toolDiameter / 2;

  // Line thickness: keep constant in world units (~5% of radius, min 0.2)
  const lineThickness = Math.max(radius * 0.05, 1);

  // Build points for circle (outer ring) – duplicate first point to close the ring
  const ringRadius = radius + radius * 0.35;

  // Build points for inner solid ring (slightly smaller radius)
  const innerCirclePoints = useMemo(() => {
    const segments = 128;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      pts.push([Math.cos(theta) * radius, Math.sin(theta) * radius, 0]);
    }
    return pts;
  }, [radius]);

  // Continuous rotation animation for dashed ring
  const { rot } = useSpring({
    from: { rot: 0 },
    to: { rot: Math.PI * 2 },
    loop: true,
    config: { duration: 4000, easing: easings.linear },
  });

  // Z-elevation: keep slightly above toolpath
  const zElev = 30;

  // Create alternating coloured arc segments for outer ring
  const segmentPairs = 12; // total color segments (even number)
  const arcSegments = useMemo(() => {
    const segmentsPerArc = 12; // points per arc segment for smoothness
    const arcs: { points: [number, number, number][]; color: string }[] = [];
    const totalSegments = segmentPairs; // even number ensures alternating colours
    const anglePerSegment = (Math.PI * 2) / totalSegments;
    for (let s = 0; s < totalSegments; s++) {
      const color = s % 2 === 0 ? innerColor : dashColor;
      const startAngle = s * anglePerSegment;
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= segmentsPerArc; i++) {
        const theta = startAngle + (i / segmentsPerArc) * anglePerSegment;
        pts.push([Math.cos(theta) * ringRadius, Math.sin(theta) * ringRadius, 0]);
      }
      arcs.push({ points: pts, color });
    }
    return arcs;
  }, [ringRadius, innerColor, dashColor]);

  if (!mpos || !visible) return null; // Not yet received a status update.
  return (
    <group position={[mpos.x, mpos.y, zElev]} renderOrder={1000 /* draw on top */}>
      {/* Crosshair */}
      <Line
        points={[
          [-radius, 0, 0],
          [radius, 0, 0],
        ]}
        color="#ffff00"
        linewidth={lineThickness}
      />
      <Line
        points={[
          [0, -radius, 0],
          [0, radius, 0],
        ]}
        color="#ffff00"
        linewidth={lineThickness}
      />

      {/* Inner constant ring (solid) */}
      <Line points={innerCirclePoints} color="#ffff00" transparent opacity={opacity} linewidth={lineThickness} />

      {/* Alternating coloured outer ring */}
      <animated.group rotation-z={rot}>
        {arcSegments.map(({ points, color }, idx) => (
          <Line key={idx} points={points} color={color} linewidth={lineThickness} />
        ))}
      </animated.group>
    </group>
  );
}

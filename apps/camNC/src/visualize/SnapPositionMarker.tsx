import { useSnapPosition, useToolDiameter, useSnapToToolpath } from '@/store/store';
import { animated, easings, useSpring } from '@react-spring/three';
import { Line } from '@react-three/drei';
import { useMemo } from 'react';

export function SnapPositionMarker({
  opacity = 0.7,
  innerColor = '#00ffff',
  dashColor = '#ff0000',
}: {
  opacity?: number;
  innerColor?: string;
  dashColor?: string;
}) {
  'use no memo';

  const enabled = useSnapToToolpath();
  const position = useSnapPosition();
  const toolDiameter = useToolDiameter();

  const radius = toolDiameter / 2;
  const lineThickness = Math.max(radius * 0.05, 1);
  const ringRadius = Math.max(radius, 6) * 1.35;

  const innerCirclePoints = useMemo(() => {
    const segments = 128;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      pts.push([Math.cos(theta) * radius, Math.sin(theta) * radius, 0]);
    }
    return pts;
  }, [radius]);

  const { rot } = useSpring({
    from: { rot: 0 },
    to: { rot: Math.PI * 2 },
    loop: true,
    config: { duration: 4000, easing: easings.linear },
  });

  const segmentPairs = 12;
  const arcSegments = useMemo(() => {
    const segmentsPerArc = 12;
    const arcs: { points: [number, number, number][]; color: string }[] = [];
    const anglePerSegment = (Math.PI * 2) / segmentPairs;
    for (let s = 0; s < segmentPairs; s++) {
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

  const zElev = 30;

  if (!enabled || !position) return null;

  return (
    <group position={[position.x, position.y, zElev]} renderOrder={1000}>
      <Line
        points={[
          [-radius, 0, 0],
          [radius, 0, 0],
        ]}
        color={innerColor}
        linewidth={lineThickness}
      />
      <Line
        points={[
          [0, -radius, 0],
          [0, radius, 0],
        ]}
        color={innerColor}
        linewidth={lineThickness}
      />
      <Line points={innerCirclePoints} color={innerColor} transparent opacity={opacity} linewidth={lineThickness} />
      <animated.group rotation-z={rot}>
        {arcSegments.map(({ points, color }, idx) => (
          <Line key={idx} points={points} color={color} linewidth={lineThickness} />
        ))}
      </animated.group>
    </group>
  );
}

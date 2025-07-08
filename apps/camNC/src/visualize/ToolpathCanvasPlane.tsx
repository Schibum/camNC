import { useStore, useToolDiameter, useToolpathOpacity } from '@/store/store';
import React from 'react';
import * as THREE from 'three';
import { DoubleSide, Vector3 } from 'three';
import { getZHeightColors } from './toolpathColors';
import { useCanvasTexture } from './useCanvasTexture';

/**
 * Render the tool-path into a plain 2-D <canvas> using the 2-D context.
 * The canvas becomes a `THREE.CanvasTexture` that we map onto a plane.
 * This guarantees exactly one fragment per pixel → no alpha accumulation.
 */
export function ToolpathCanvasPlane() {
  const toolpath = useStore(s => s.toolpath);
  const toolDiameter = useToolDiameter();
  const toolpathOpacity = useToolpathOpacity();

  const bounds = toolpath?.getBounds();

  // Original bounding size (without stroke thickness)
  const origSize = React.useMemo(() => {
    if (!bounds) return null;
    const size = new Vector3();
    bounds.getSize(size);
    return size;
  }, [bounds]);

  // Add a margin equal to half the tool diameter so wide strokes aren't clipped
  const strokeMargin = toolDiameter / 2; // world-units

  const expandedSize = React.useMemo(() => {
    if (!origSize) return new Vector3(0, 0, 0);
    return new Vector3(origSize.x + 2 * strokeMargin, origSize.y + 2 * strokeMargin, origSize.z);
  }, [origSize, strokeMargin]);

  const materialRef = React.useRef<THREE.MeshBasicMaterial>(null!);

  const pxPerUnit = getPxPerUnit(expandedSize);
  const { texture, canvas, ctx } = useCanvasTexture(Math.ceil(expandedSize.x * pxPerUnit), Math.ceil(expandedSize.y * pxPerUnit));

  React.useEffect(() => {
    if (!toolpath || !expandedSize) return;

    // Smoothing & filtering
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    ctx.imageSmoothingEnabled = true;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Stroke setup
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = toolDiameter;

    // World → pixel transform
    const tx = -(bounds!.min.x - strokeMargin) * pxPerUnit;
    const ty = expandedSize.y * pxPerUnit + (bounds!.min.y - strokeMargin) * pxPerUnit;
    ctx.setTransform(pxPerUnit, 0, 0, -pxPerUnit, tx, ty);

    // Draw segments sorted by Z
    const colors = getZHeightColors(toolpath);
    const segments: { idx: number; z: number }[] = [];
    for (let i = 1; i < toolpath.pathPoints.length; i++) {
      const z = (toolpath.pathPoints[i - 1].z + toolpath.pathPoints[i].z) / 2;
      segments.push({ idx: i, z });
    }
    segments.sort((a, b) => b.z - a.z);

    for (const { idx } of segments) {
      const r = colors[(idx - 1) * 3];
      const g = colors[(idx - 1) * 3 + 1];
      const b = colors[(idx - 1) * 3 + 2];

      ctx.strokeStyle = `rgb(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)})`;

      const p0 = toolpath.pathPoints[idx - 1];
      const p1 = toolpath.pathPoints[idx];

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    texture.needsUpdate = true;
  }, [toolpath, texture, expandedSize, toolDiameter, bounds, strokeMargin, pxPerUnit, ctx, canvas]);

  // update material map when texture object changes
  React.useEffect(() => {
    if (materialRef.current) {
      materialRef.current.map = texture;
    }
  }, [texture]);

  if (!expandedSize) return null;

  return (
    <mesh
      position={[expandedSize.x / 2 + (bounds!.min.x - strokeMargin), expandedSize.y / 2 + (bounds!.min.y - strokeMargin), bounds!.min.z]}
      renderOrder={50}>
      <planeGeometry args={[expandedSize.x, expandedSize.y]} />
      <meshBasicMaterial ref={materialRef} map={texture} transparent opacity={toolpathOpacity} side={DoubleSide} />
    </mesh>
  );
}

// Returns pixel density (px/unit) that fits the drawing into MAX_TEX while
// honouring the base supersampling factor.
const MAX_TEX = 16384;
function getPxPerUnit(size: Vector3): number {
  const dpr = window.devicePixelRatio || 1;
  const base = 5 * dpr * 2; // base supersampling
  return Math.max(1, Math.min(base, MAX_TEX / size.x, MAX_TEX / size.y));
}

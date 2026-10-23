import { useStore, useToolDiameter, useToolpathOpacity } from '@/store/store';
import React from 'react';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { getCutZRange, isRapidSegment } from './depthInspection';
import { getZHeightColors } from './toolpathColors';
import { useCanvasTexture } from './useCanvasTexture';

const kOutlineColor = 'rgba(0, 0, 0, 0.7)';
const kRapidColor = 'rgba(241, 245, 249, 0.95)';

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
    texture.colorSpace = THREE.SRGBColorSpace;
    ctx.imageSmoothingEnabled = true;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Stroke setup
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // World → pixel transform
    const tx = -(bounds!.min.x - strokeMargin) * pxPerUnit;
    const ty = expandedSize.y * pxPerUnit + (bounds!.min.y - strokeMargin) * pxPerUnit;
    ctx.setTransform(pxPerUnit, 0, 0, -pxPerUnit, tx, ty);

    // Colors spread over the cutting depths, like the 3D views, so retract heights don't squeeze them into one color.
    const colors = getZHeightColors(toolpath, getCutZRange(toolpath));
    const cuts: { idx: number; z: number }[] = [];
    const rapids: number[] = [];
    for (let i = 1; i < toolpath.pathPoints.length; i++) {
      if (toolpath.pathPoints[i - 1].equals(toolpath.pathPoints[i])) continue;
      if (isRapidSegment(toolpath, i)) {
        rapids.push(i);
      } else {
        cuts.push({ idx: i, z: (toolpath.pathPoints[i - 1].z + toolpath.pathPoints[i].z) / 2 });
      }
    }
    // Deepest cuts last, on top.
    cuts.sort((a, b) => b.z - a.z);

    const segment = (idx: number) => {
      const p0 = toolpath.pathPoints[idx - 1];
      const p1 = toolpath.pathPoints[idx];
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    };

    // A thin dark outline below all cuts keeps them readable on light and dark camera images.
    const outline = Math.max(toolDiameter * 0.12, 0.3);
    ctx.strokeStyle = kOutlineColor;
    ctx.lineWidth = toolDiameter + 2 * outline;
    for (const { idx } of cuts) segment(idx);

    // Cuts are as wide as the tool, showing the material they remove.
    ctx.lineWidth = toolDiameter;
    // `colors` are in three's linear working space, the canvas takes sRGB.
    const color = new THREE.Color();
    for (const { idx } of cuts) {
      const r = colors[(idx - 1) * 3];
      const g = colors[(idx - 1) * 3 + 1];
      const b = colors[(idx - 1) * 3 + 2];
      ctx.strokeStyle = `#${color.setRGB(r, g, b).getHexString()}`;
      segment(idx);
    }

    // Rapids remove no material: thin dashed lines on top, like in the 3D views.
    const rapidWidth = Math.max(toolDiameter * 0.18, 0.4);
    const dash = Math.max(toolDiameter * 0.8, 1.5);
    ctx.lineCap = 'butt';
    ctx.setLineDash([dash, dash * 0.7]);
    ctx.strokeStyle = kOutlineColor;
    ctx.lineWidth = rapidWidth + 2 * outline;
    for (const idx of rapids) segment(idx);
    ctx.strokeStyle = kRapidColor;
    ctx.lineWidth = rapidWidth;
    for (const idx of rapids) segment(idx);
    ctx.setLineDash([]);

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
      position={[expandedSize.x / 2 + (bounds!.min.x - strokeMargin), expandedSize.y / 2 + (bounds!.min.y - strokeMargin), 0]}
      renderOrder={-1}>
      <planeGeometry args={[expandedSize.x, expandedSize.y]} />
      <meshBasicMaterial ref={materialRef} map={texture} transparent opacity={toolpathOpacity} depthWrite={false} />
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

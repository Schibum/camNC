import { type CadDocument, type CadPoint } from '@wbcnc/cad';
import { useMemo } from 'react';
import { sketchRegionLoops } from './sketchRegions';

/** Closed CAD faces remain visible while unrelated geometry is open or unsuitable for machining. */
function closedRegionPath(document: CadDocument, partId: string | undefined): string | null {
  const part = document.parts.find(candidate => candidate.id === partId);
  if (!part) return null;
  const regions = sketchRegionLoops(part.sketch);
  if (!regions.length) return null;
  const loop = (points: CadPoint[]) => points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ') + ' Z';
  return regions.map(loop).join(' ');
}

export function SketchRegion({ document, partId, verified }: { document: CadDocument; partId: string | undefined; verified: boolean }) {
  const path = useMemo(() => (verified ? closedRegionPath(document, partId) : null), [document, partId, verified]);
  return path ? (
    <path data-sketch-region={partId} className="cad-sketch-region" d={path} fillRule="nonzero" pointerEvents="none" aria-hidden="true" />
  ) : null;
}

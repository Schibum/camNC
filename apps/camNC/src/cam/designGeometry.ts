import type { CadPoint, EvaluatedCadPart } from '@wbcnc/cad';

function designBounds(part: EvaluatedCadPart) {
  return {
    x0: Math.min(...part.outline.map(p => p.x)),
    y0: Math.min(...part.outline.map(p => p.y)),
    x1: Math.max(...part.outline.map(p => p.x)),
    y1: Math.max(...part.outline.map(p => p.y)),
  };
}

/** Shape identity ignores names, labels, solver noise, loop starting vertices, and whole-sketch translation. */
export function designGeometryFingerprint(part: EvaluatedCadPart) {
  const bounds = designBounds(part);
  const ring = (points: CadPoint[]) => {
    const values = points.map(p => `${+(p.x - bounds.x0).toFixed(6)},${+(p.y - bounds.y0).toFixed(6)}`);
    const first = values.reduce((best, value, i) => (value < values[best] ? i : best), 0);
    return [...values.slice(first), ...values.slice(0, first)].join(';');
  };
  const plain = [part.thickness, ring(part.outline), part.holes.map(ring).sort()];
  // Parts without cuts keep the exact fingerprint they always had, so cut sheets stay valid.
  if (!part.cuts?.length) return JSON.stringify(plain);
  const cuts = part.cuts.map(cut => [cut.side, cut.from, cut.to, cut.through, ring(cut.outline), cut.islands.map(ring).sort()]);
  return JSON.stringify([...plain, cuts]);
}

/** Content identity for physical stock; cache revisions remain monotonic even when this identity returns. */
export async function designGeometryKey(part: EvaluatedCadPart): Promise<string> {
  const bytes = new TextEncoder().encode(`native-part-v1:${designGeometryFingerprint(part)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

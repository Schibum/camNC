import { describe, expect, it } from 'vitest';
import { arcPreviewPath, buildArcPreview } from './arcPreviewGeometry';

describe('arc command previews', () => {
  it('suggests a shallow curve while choosing a fresh endpoint without imposing a tangent', () => {
    const preview = buildArcPreview({ mode: 'threePoint', pending: [{ x: 0, y: 0 }], cursor: { x: 40, y: 20 } })!;
    expect(preview.phase).toBe('end');
    expect(preview.provisional).toBe(true);
    expect(preview.arc).toMatchObject({ cx: expect.closeTo(44), cy: expect.closeTo(-38), radius: expect.closeTo(Math.sqrt(3380)) });
    expect(arcPreviewPath(preview.arc!)).toContain(' A ');
  });

  it('uses the incoming chain tangent for a contextual A suggestion without making it a constraint', () => {
    const preview = buildArcPreview({
      mode: 'threePoint',
      pending: [{ x: 40, y: 20 }],
      cursor: { x: 60, y: 40 },
      tangent: { x: 0, y: 1 },
    })!;
    expect(preview.arc).toMatchObject({ cx: expect.closeTo(60), cy: expect.closeTo(20), radius: expect.closeTo(20) });
    expect(preview.provisional).toBe(true);
  });

  it('uses a finite shallow curve for horizontal endpoints like the native endpoint preview', () => {
    const preview = buildArcPreview({ mode: 'threePoint', pending: [{ x: 0, y: 0 }], cursor: { x: 40, y: 0 } })!;
    expect(preview.arc).toMatchObject({ cx: 20, cy: -48, radius: 52 });
    expect(arcPreviewPath(preview.arc!)).not.toMatch(/NaN|Infinity/);
  });

  it('keeps the suggested curve visible after fixing the end until a noncollinear through point is chosen', () => {
    const start = { x: 0, y: 0 },
      end = { x: 40, y: 20 };
    const endpoint = buildArcPreview({ mode: 'threePoint', pending: [start], cursor: end })!;
    const pending = [start, end];
    for (const cursor of [end, start, { x: 20, y: 10 }]) {
      const through = buildArcPreview({ mode: 'threePoint', pending, cursor })!;
      expect(through.phase).toBe('through');
      expect(through.provisional).toBe(true);
      expect(through.arc).toEqual(endpoint.arc);
      expect(through.instruction).toContain('Move off chord');
    }
    expect(pending).toEqual([start, end]);
  });

  it('replaces the suggestion with the actual arc through the cursor on either side of the chord', () => {
    const start = { x: 0, y: 0 },
      end = { x: 40, y: 0 };
    for (const cursor of [
      { x: 20, y: 30 },
      { x: 20, y: -30 },
    ]) {
      const preview = buildArcPreview({ mode: 'threePoint', pending: [start, end], cursor })!;
      expect(preview.provisional).toBe(false);
      for (const point of [start, end, cursor])
        expect(Math.hypot(point.x - preview.arc!.cx, point.y - preview.arc!.cy)).toBeCloseTo(preview.arc!.radius);
      expect(preview.instruction).toBe('Click point on arc');
    }
  });

  it('never suggests an uncommittable semicircle for a degenerate Shift+A tangent gesture', () => {
    const preview = buildArcPreview({ mode: 'tangent', pending: [{ x: 0, y: 0 }], cursor: { x: 40, y: 0 }, tangent: { x: 1, y: 0 } })!;
    expect(preview.arc).toBeNull();
    expect(preview.instruction).toBe('Move away from tangent line');
    const curved = buildArcPreview({ mode: 'tangent', pending: [{ x: 0, y: 0 }], cursor: { x: 40, y: 20 }, tangent: { x: 1, y: 0 } })!;
    expect(curved.provisional).toBe(false);
    expect(curved.arc).toMatchObject({ cx: expect.closeTo(0), cy: expect.closeTo(50), radius: expect.closeTo(50) });
  });
});

import { describe, expect, it } from 'vitest';
import { addArc, addLine, createCadDocument, createCadPart, evaluateCadDocument } from './index';

describe('analytic line/arc contacts', () => {
  it.each([
    ...[0, 0.001093675931716, Math.PI / 3, Math.PI / 2, -Math.PI / 2].map(rotation => [
      rotation,
      22.024322529453137,
      22.024093519707936,
      77.99153019255213,
    ]),
    ...[0.001093675931716, 0.00317, Math.PI / 3, Math.PI / 2, -Math.PI / 2].map(rotation => [rotation, 10_000, 125_000, -75_000]),
  ])('keeps a rotated translated rounded corner joined at its true tangent endpoint (%s radians, R%s)', (rotation, radius, cx, cy) => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    const transform = (x: number, y: number) => ({
      x: cx! + x * Math.cos(rotation!) - y * Math.sin(rotation!),
      y: cy! + x * Math.sin(rotation!) + y * Math.cos(rotation!),
    });
    part.sketch = addArc(part.sketch, { cx: cx!, cy: cy!, radius: radius!, startAngle: rotation!, endAngle: rotation! + Math.PI / 2 });
    const vertices = [
      [0, radius!],
      [-66.0288, radius!],
      [-66.0288, -40],
      [radius!, -40],
      [radius!, 0],
    ];
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = transform(vertices[i]![0]!, vertices[i]![1]!);
      const b = transform(vertices[i + 1]![0]!, vertices[i + 1]![1]!);
      part.sketch = addLine(part.sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    const result = evaluateCadDocument(document);
    expect(result.diagnostics, JSON.stringify(result.diagnostics)).toEqual([]);
    expect(result.parts[0]!.loops).toHaveLength(1);
  });

  it.each([
    [20, 0, 0, 0.01],
    [10_000, 125_000, -75_000, 0.001],
  ])('still rejects a shallow second crossing beside a shared endpoint at R%s', (radius, cx, cy, inset) => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    part.sketch = addArc(part.sketch, { cx: cx!, cy: cy!, radius: radius!, startAngle: 0, endAngle: Math.PI / 2 });
    const arc = part.sketch.entities.find(entity => entity.type === 'arc')!;
    part.sketch = addLine(part.sketch, { x1: cx!, y1: cy! + radius!, x2: cx! + 40, y2: cy! + radius! - inset! });
    const crossingLine = part.sketch.entities.filter(entity => entity.type === 'line').at(-1)!;
    part.sketch = addLine(part.sketch, { x1: cx! + 40, y1: cy! + radius! - inset!, x2: cx! + 40, y2: cy! - 20 });
    part.sketch = addLine(part.sketch, { x1: cx! + 40, y1: cy! - 20, x2: cx! + radius!, y2: cy! });
    const result = evaluateCadDocument(document);
    expect(result.parts).toEqual([]);
    expect(
      result.diagnostics.some(
        diagnostic =>
          diagnostic.code === 'intersecting-profiles' &&
          diagnostic.entityIds?.includes(arc.id) &&
          diagnostic.entityIds.includes(crossingLine.id)
      )
    ).toBe(true);
  });
});

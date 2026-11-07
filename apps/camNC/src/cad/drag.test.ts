import { addArc, addLine, createCadPart } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { dragTargets } from './drag';

describe('sketch drag intent', () => {
  it('keeps a fixed origin out of pointer targets while allowing the other end of its line to move', () => {
    const sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 30, y2: 10 });
    const line = sketch.entities.find(e => e.type === 'line')!;
    expect(dragTargets(sketch, [line.id], { x: 5, y: 7 })).toEqual([{ pointId: line.endId, x: 35, y: 17 }]);
    expect(dragTargets(sketch, [line.startId], { x: 5, y: 7 })).toEqual([]);
  });

  it('moves a selected endpoint independently and includes all arc parameters in a body translation', () => {
    const sketch = addArc(createCadPart().sketch, { cx: 20, cy: 20, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
    const arc = sketch.entities.find(e => e.type === 'arc')!;
    expect(dragTargets(sketch, [arc.startId], { x: 3, y: 4 })).toEqual([{ pointId: arc.startId, x: 33, y: 24 }]);
    expect(
      dragTargets(sketch, [arc.id], { x: 3, y: 4 })
        .map(t => t.pointId)
        .sort()
    ).toEqual([arc.centerId, arc.startId, arc.endId].sort());
  });
});

import { Box2, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { getMachinePlaneLayout } from './machinePlane';

describe('getMachinePlaneLayout', () => {
  it('covers bounds starting at the origin', () => {
    const layout = getMachinePlaneLayout(new Box2(new Vector2(0, 0), new Vector2(600, 400)), 50);
    expect(layout).toEqual({ width: 650, height: 450, center: new Vector2(300, 200) });
  });

  it('covers negative bounds', () => {
    const layout = getMachinePlaneLayout(new Box2(new Vector2(-600, -400), new Vector2(0, 0)), 50);
    expect(layout).toEqual({ width: 650, height: 450, center: new Vector2(-300, -200) });
  });

  it('covers offset bounds', () => {
    const layout = getMachinePlaneLayout(new Box2(new Vector2(6, -10), new Vector2(606, 390)));
    expect(layout).toEqual({ width: 600, height: 400, center: new Vector2(306, 190) });
  });
});

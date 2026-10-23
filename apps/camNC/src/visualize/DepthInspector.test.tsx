import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { Box2, Vector2 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepthInspector } from './DepthInspector';
import { parseGCode } from './gcodeParsing';

const store = vi.hoisted(() => ({ stockHeight: 0, toolpathOffset: { x: 0, y: 0, z: 0 }, hasCamera: false }));

// The real store pulls in server-only modules.
vi.mock('@/store/store', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
  useCamSource: () => (store.hasCamera ? { extrinsics: {}, machineBounds: {} } : null),
  useMachineBounds: () => new Box2(new Vector2(0, 0), new Vector2(100, 100)),
}));
vi.mock('@/calibration/Unproject', () => ({ UnprojectVideoMesh: () => null }));

const gcode = `
G0 X0 Y0 Z5
G1 Z-1 F100
G1 X40
G1 Y20
G1 Z-2.5
G1 X0
G1 Y0
G0 Z5
`;

function renderInspector(code: string) {
  return render(
    <div style={{ width: 800, height: 500 }}>
      <DepthInspector toolpath={parseGCode(code)} />
    </div>
  );
}

afterEach(() => {
  cleanup();
  store.stockHeight = 0;
  store.hasCamera = false;
});

describe('DepthInspector', () => {
  it('lists cut levels and highlights the selected one', () => {
    renderInspector(gcode);
    expect(screen.getByRole('region', { name: 'Depth Inspector' }).querySelector('canvas')).not.toBeNull();
    expect(screen.getByRole('button', { name: /-1\.00\s*60mm/ })).toBeTruthy();
    const deepest = screen.getByRole('button', { name: /-2\.50\s*60mm/ });
    fireEvent.click(deepest);
    expect(deepest.className).toContain('bg-sky-500/20');
  });

  it('offers the stock video only with a calibrated camera', () => {
    renderInspector(gcode);
    expect(screen.queryByRole('switch', { name: 'Stock video' })).toBeNull();
    cleanup();
    store.hasCamera = true;
    renderInspector(gcode);
    expect(screen.getByRole('switch', { name: 'Stock video' })).toBeTruthy();
  });

  it('warns when cutting below the stock bottom', () => {
    store.stockHeight = 2;
    renderInspector(gcode);
    expect(screen.getByText('0.50mm below stock')).toBeTruthy();
  });

  it('reads out the exact position of the hovered path point', async () => {
    // The last segment crosses the center of the bounds at Z -1.25.
    renderInspector('G1 X40 Z-1.25 F100\nG1 Y20\nG1 X0 Y0');
    fireEvent.click(screen.getByRole('button', { name: 'Top' }));
    const canvas = screen.getByRole('region', { name: 'Depth Inspector' }).querySelector('canvas')!;
    const topButton = screen.getByRole('button', { name: 'Top' });
    // Retry until the camera has been fitted, leaving the canvas in between to trigger a fresh pointer move.
    await waitFor(async () => {
      await userEvent.hover(topButton);
      await userEvent.hover(canvas);
      expect(screen.getByText(/Z -1\.25/)).toBeTruthy();
    });
  });
});

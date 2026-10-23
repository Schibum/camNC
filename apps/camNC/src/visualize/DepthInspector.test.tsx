import { Canvas } from '@react-three/fiber';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { Box2, Vector2 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepthHoverReadout, DepthPanel, DepthScene, DepthViewPreset } from './DepthInspector';
import { useDepthView } from './depthViewStore';
import { parseGCode } from './gcodeParsing';

const store = vi.hoisted(() => ({ stockHeight: 0, toolpathOffset: { x: 0, y: 0, z: 0 }, hasCamera: false }));

// The real store pulls in server-only modules.
vi.mock('@/store/store', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
  useCamSource: () => (store.hasCamera ? { extrinsics: {}, machineBounds: {} } : null),
  useMachineBounds: () => new Box2(new Vector2(0, 0), new Vector2(100, 100)),
}));

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

function renderPanel(code: string) {
  return render(<DepthPanel toolpath={parseGCode(code)} />);
}

afterEach(() => {
  cleanup();
  store.stockHeight = 0;
  store.hasCamera = false;
  useDepthView.setState({ selected: null, hover: null, videoEnabled: true, zeroAt: null });
});

describe('DepthPanel', () => {
  it('lists cut levels and highlights the selected one', () => {
    renderPanel(gcode);
    expect(screen.getByRole('button', { name: /-1\.00\s*60mm/ })).toBeTruthy();
    const deepest = screen.getByRole('button', { name: /-2\.50\s*60mm/ });
    fireEvent.click(deepest);
    expect(deepest.className).toContain('bg-sky-500/20');
  });

  it('clears the selected level when another toolpath is loaded', () => {
    const { rerender } = renderPanel(gcode);
    fireEvent.click(screen.getByRole('button', { name: /-2\.50\s*60mm/ }));
    rerender(<DepthPanel toolpath={parseGCode(gcode)} />);
    expect(screen.getByRole('button', { name: /-2\.50\s*60mm/ }).className).not.toContain('bg-sky-500/20');
  });

  it('collapses to the depth summary', () => {
    renderPanel(gcode);
    fireEvent.click(screen.getByRole('button', { name: /Depth\s*-2\.50/ }));
    expect(screen.queryByRole('button', { name: /-1\.00\s*60mm/ })).toBeNull();
  });

  it('offers the stock video only with a calibrated camera', () => {
    renderPanel(gcode);
    expect(screen.queryByRole('switch', { name: 'Stock video' })).toBeNull();
    cleanup();
    store.hasCamera = true;
    renderPanel(gcode);
    expect(screen.getByRole('switch', { name: 'Stock video' })).toBeTruthy();
  });

  it('warns when cutting below the stock bottom', () => {
    store.stockHeight = 2;
    renderPanel(gcode);
    expect(screen.getByText('0.50mm below stock')).toBeTruthy();
  });

  it('guesses Z0 at the stock bottom for toolpaths that stay above it', () => {
    store.stockHeight = 10;
    renderPanel('G0 Z15\nG1 X10 Z2 F100\nG1 X20');
    expect(screen.getByRole('button', { name: 'Bottom', pressed: true })).toBeTruthy();
    expect(screen.getByText('Guessed from the toolpath')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Top' }));
    expect(screen.getByRole('button', { name: 'Top', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use guess (bottom)' }));
    expect(screen.getByRole('button', { name: 'Bottom', pressed: true })).toBeTruthy();
  });

  it('warns about cuts below Z0 with Z0 at the stock bottom', () => {
    store.stockHeight = 10;
    renderPanel('G0 Z15\nG1 X10 Z2 F100\nG1 Z-0.5\nG1 X20');
    // Cutting below 0, so the stock top is guessed, where the same cuts are well within the stock.
    expect(screen.getByText('Stock: 10.00mm')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
    expect(screen.getByText('0.50mm below Z0')).toBeTruthy();
  });
});

describe('DepthScene', () => {
  function renderScene(code: string, view: DepthViewPreset) {
    const toolpath = parseGCode(code);
    render(
      <>
        <div style={{ width: 800, height: 500 }} data-testid="scene">
          <Canvas orthographic camera={{ up: [0, 0, 1] }}>
            <DepthScene toolpath={toolpath} view={view} fitKey={0} />
          </Canvas>
        </div>
        <DepthHoverReadout toolpath={toolpath} />
        <button type="button">Outside</button>
      </>
    );
    return toolpath;
  }

  it('reads out the exact position of the hovered path point', async () => {
    // Seen from the front, the diagonal plunge crosses the center of the fitted view at Z -0.50.
    renderScene('G1 X40 Z-1 F100', 'front');
    const canvas = screen.getByTestId('scene').querySelector('canvas')!;
    const outside = screen.getByRole('button', { name: 'Outside' });
    // Retry until the camera has moved into place, leaving the canvas in between to trigger a fresh pointer move.
    await waitFor(
      async () => {
        await userEvent.hover(outside);
        await userEvent.hover(canvas);
        expect(screen.getByText(/Z -0\.50/)).toBeTruthy();
      },
      { timeout: 5000 }
    );
  });

  it('forgets the hovered point of a previous toolpath', () => {
    const previous = parseGCode(gcode);
    act(() => useDepthView.getState().setHover(previous, { point: previous.getBounds().min }));
    renderScene(gcode, '3d');
    expect(screen.getByText('Hover the path to read exact positions')).toBeTruthy();
  });
});

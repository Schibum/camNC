import { Canvas } from '@react-three/fiber';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { Box2, Vector2 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepthHoverReadout, DepthPanel, DepthScene, DepthViewPreset } from './DepthInspector';
import { useDepthView } from './depthViewStore';
import { parseGCode } from './gcodeParsing';

const store = vi.hoisted(() => ({
  stockHeight: 0,
  toolpathOffset: { x: 0, y: 0, z: 0 },
  hasCamera: false,
  setStockHeight: (height: number) => {
    store.stockHeight = height;
  },
}));

// The real store pulls in server-only modules.
vi.mock('@/store/store', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
  useIsCameraReady: () => store.hasCamera,
  useMachineBounds: () => new Box2(new Vector2(0, 0), new Vector2(100, 100)),
  useShowMachinePosMarker: () => true,
  useToolDiameter: () => 6,
}));

// No machine connected: the tool marker and the job progress stay hidden.
vi.mock('@/lib/fluidnc/machine', async () => {
  const { signal } = await import('@preact/signals-react');
  const status = signal(null);
  return {
    getCncApi: () => ({ status, machinePos: signal(null), workPos: signal(null), jobProgress: signal(null) }),
  };
});
vi.mock('@/lib/machine/jobs', () => ({ kJobFileName: 'camnc.gcode' }));

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
    expect(deepest.className).toContain('bg-sky-500/25');
  });

  it('clears the selected level when another toolpath is loaded', () => {
    const { rerender } = renderPanel(gcode);
    fireEvent.click(screen.getByRole('button', { name: /-2\.50\s*60mm/ }));
    rerender(<DepthPanel toolpath={parseGCode(gcode)} />);
    expect(screen.getByRole('button', { name: /-2\.50\s*60mm/ }).className).not.toContain('bg-sky-500/25');
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

  it('sets the Z scale from the presets', () => {
    renderPanel(gcode);
    fireEvent.click(screen.getByRole('button', { name: '5×' }));
    expect(useDepthView.getState().zScale).toBe(5);
    expect(screen.getByRole('button', { name: '5×', pressed: true })).toBeTruthy();
    act(() => useDepthView.getState().setZScale(1));
  });

  it('shows the depth summary', () => {
    store.stockHeight = 3;
    renderPanel(gcode);
    for (const [label, value] of [
      ['Min Z', '-2.50'],
      ['Max Z', '5.00'],
    ]) {
      expect(screen.getByText(label).nextElementSibling?.textContent).toBe(value);
    }
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Stock height' }).value).toBe('3');
  });

  it('asks for the stock height until it is set', () => {
    const { rerender } = renderPanel(gcode);
    expect(screen.getByText('Not set, needed for the stock')).toBeTruthy();
    // Stays visible with the panel collapsed.
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    const input = screen.getByRole('spinbutton', { name: 'Stock height' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '12.5' } });
    expect(store.stockHeight).toBe(12.5);
    // Not hidden mid-typing.
    rerender(<DepthPanel toolpath={parseGCode(gcode)} />);
    expect(screen.getByRole('spinbutton', { name: 'Stock height' })).toBe(input);
    act(() => input.blur());
    // Done, so it moves out of the way with the rest of the panel.
    expect(screen.queryByRole('spinbutton', { name: 'Stock height' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Stock height')).toBeTruthy();
    expect(screen.queryByText('Not set, needed for the stock')).toBeNull();
  });

  it('warns when cutting below the stock bottom', () => {
    store.stockHeight = 1.5;
    renderPanel(gcode);
    expect(screen.getByText('1.00mm below stock')).toBeTruthy();
  });

  it('notes a small overcut below the stock bottom without warning', () => {
    store.stockHeight = 2.2;
    renderPanel(gcode);
    expect(screen.getByText('0.30mm overcut below stock')).toBeTruthy();
    expect(screen.queryByText(/mm below stock/)).toBeNull();
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
    renderPanel('G0 Z15\nG1 X10 Z2 F100\nG1 Z-1.5\nG1 X20');
    // Cutting well below 0, so the stock top is guessed, where the same cuts are well within the stock.
    expect(screen.queryByText(/below/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
    expect(screen.getByText('1.50mm below Z0')).toBeTruthy();
  });

  it('treats a small cut below Z0 as an overcut of a toolpath zeroed at the stock bottom', () => {
    store.stockHeight = 10;
    renderPanel('G0 Z15\nG1 X10 Z2 F100\nG1 Z-0.3\nG1 X20');
    expect(screen.getByRole('button', { name: 'Bottom', pressed: true })).toBeTruthy();
    expect(screen.getByText('0.30mm overcut below Z0')).toBeTruthy();
    expect(screen.queryByText(/mm below Z0/)).toBeNull();
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
        expect(screen.getByText(/^-0\.50$/).textContent).toBe('Z -0.50');
      },
      { timeout: 5000 }
    );
  });

  it('keeps hover working while a level is selected', async () => {
    const toolpath = renderScene('G1 X40 Z-1 F100', 'front');
    // Selecting a level recolors the path, which must not drop its pointer handlers.
    act(() => useDepthView.getState().setSelected(toolpath, -1));
    const canvas = screen.getByTestId('scene').querySelector('canvas')!;
    const outside = screen.getByRole('button', { name: 'Outside' });
    await waitFor(
      async () => {
        await userEvent.hover(outside);
        await userEvent.hover(canvas);
        expect(screen.getByText(/^-0\.50$/).textContent).toBe('Z -0.50');
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

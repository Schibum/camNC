import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../style.css';
import { CanvasLabel } from './CanvasLabel';
import { CamBedLayer } from '../cam/machine/CamBedLayer';
import { useBedEdit } from '../cam/machine/bedEdit';

afterEach(() => {
  cleanup();
  useBedEdit.setState({ bed: null, selected: null, note: null });
});

describe('world-anchored canvas labels', () => {
  it('keeps the real selected-part toolbar and warning inside the top-down canvas', async () => {
    const openInCam = vi.fn();
    useBedEdit.setState({
      bed: {
        boardId: 'board',
        parts: [{ id: 'socket', name: 'socket', x: 150, y: -80, w: 20, h: 30, rotated: false, movable: true }],
        locked: null,
        check: () => 'free',
        drop: () => 'exact',
        rotate: () => {},
        openInCam,
      },
      selected: { kind: 'part', id: 'socket' },
      note: { at: { x: 150, y: -60 }, text: 'socket moved to the nearest free spot', tone: 'warn' },
    });
    render(
      <div data-testid="canvas-area" style={{ width: 320, height: 200 }}>
        <Canvas orthographic camera={{ position: [0, 0, 100], zoom: 1 }}>
          <CamBedLayer overlay={{ boardId: 'board', w: 300, h: 200, rotationDeg: 0 }} offset={{ x: 0, y: 0 }} running={false} />
        </Canvas>
      </div>
    );
    await expectContained('socket');
    await waitFor(() => {
      const warning = screen.getByText('socket moved to the nearest free spot').getBoundingClientRect();
      const canvas = screen.getByTestId('canvas-area').getBoundingClientRect();
      expect(warning.right).toBeLessThanOrEqual(canvas.right - 7);
      expect(warning.left).toBeGreaterThanOrEqual(canvas.left + 7);
    });
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Layout in CAM' }));
      expect(openInCam).toHaveBeenCalledWith('layout');
    });
  });

  it.each([
    [150, -95],
    [-170, 110],
    [400, -400],
  ])('keeps a selected part bar within the canvas at (%s, %s)', async (x, y) => {
    const openLayout = vi.fn();
    const { rerender } = render(<Scene x={x} y={y} onClick={openLayout} width={320} />);
    await expectContained('Selected socket');
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Layout in CAM' }));
      expect(openLayout).toHaveBeenCalledOnce();
    });

    // Opening the machine dock or resizing the window leaves less canvas space.
    rerender(<Scene x={x} y={y} onClick={openLayout} width={180} />);
    await expectContained('Selected socket');
  });

  it('wraps a warning with a long part name inside a narrow canvas', async () => {
    const scene = (width: number) => (
      <div data-testid="canvas-area" style={{ width, height: 200 }}>
        <Canvas orthographic camera={{ position: [0, 0, 100], zoom: 1 }}>
          <group rotation-z={Math.PI / 2} position={[80, -80, 0]}>
            <CanvasLabel position={[0, 0, 0]}>
              <span data-testid="warning" className="block max-w-full bg-amber-400 p-2 text-xs">
                {`socket-${'long-part-name-'.repeat(10)}: too close to the next part`}
              </span>
            </CanvasLabel>
          </group>
        </Canvas>
      </div>
    );
    const { rerender } = render(scene(320));
    await expectContained('warning', true);
    rerender(scene(180));
    // Html owns a separate React root and can replace its label during canvas resize.
    // Query and check both layout invariants in the same retried observation.
    await expectContained('warning', true, warning => {
      expect(warning.scrollWidth).toBeLessThanOrEqual(warning.clientWidth);
    });
  });
});

function Scene({ x, y, width, onClick }: { x: number; y: number; width: number; onClick: () => void }) {
  return (
    <div data-testid="canvas-area" style={{ width, height: 200 }}>
      <Canvas orthographic camera={{ position: [0, 0, 100], zoom: 1 }}>
        <CanvasLabel position={[x, y, 0]} offset={[0, 12]} maxWidth={384} interactive>
          <div role="toolbar" aria-label="Selected socket" className="flex max-w-full flex-wrap gap-1 rounded bg-background p-1 text-xs">
            <span>socket</span>
            <button onClick={onClick}>Layout in CAM</button>
            <button>Toolpaths in CAM</button>
          </div>
        </CanvasLabel>
      </Canvas>
    </div>
  );
}

async function expectContained(name: string, warning = false, check?: (label: HTMLElement) => void) {
  await waitFor(
    () => {
      const label = warning ? screen.getByTestId(name) : screen.getByRole('toolbar', { name });
      const bounds = label.getBoundingClientRect();
      const canvas = screen.getByTestId('canvas-area').getBoundingClientRect();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.left).toBeGreaterThanOrEqual(canvas.left + 7);
      expect(bounds.right).toBeLessThanOrEqual(canvas.right - 7);
      expect(bounds.top).toBeGreaterThanOrEqual(canvas.top + 7);
      expect(bounds.bottom).toBeLessThanOrEqual(canvas.bottom - 7);
      check?.(label);
    },
    { timeout: 10_000 }
  );
}

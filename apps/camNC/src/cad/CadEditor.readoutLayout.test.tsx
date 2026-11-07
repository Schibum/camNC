import { addLine, createCadDocument, createCadPart } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { page, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const initialViewport = { width: window.innerWidth, height: window.innerHeight };
const sessions: string[] = [];
afterEach(async () => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
  setDemoModeForTest(false);
  await page.viewport(initialViewport.width, initialViewport.height);
});

describe.each([false, true])('selection measurements beside sketch feedback (demo: %s)', demo => {
  it('keeps the readout visible and reachable at wide and narrow viewport sizes', async () => {
    setDemoModeForTest(demo);
    const source = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 100, y2: 20 });
    source.parts.push(part);
    sessions.push(source.id);
    render(
      <div style={{ height: 'calc(100vh - 16px)' }}>
        <CadEditor document={source} onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
      </div>
    );
    const progress = (await screen.findByText('Sketch in progress', undefined, { timeout: 20_000 })).parentElement!;
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const position = new DOMPoint(60, -20).matrixTransform(canvas.getScreenCTM()!);
    const bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: position.x - bounds.left, y: position.y - bounds.top } });
    const readout = screen.getByRole('status', { name: 'Selection measurements' });
    expect(readout.textContent).toContain('80 mm');
    for (const width of [1440, 673, 520]) {
      await page.viewport(width, 900);
      await waitFor(() => {
        const measurementBounds = readout.getBoundingClientRect();
        const noticeBounds = progress.getBoundingClientRect();
        const canvas = screen.getByTestId('cad-canvas');
        const editor = canvas.closest('.cad-editor')!;
        const canvasFooter = editor.querySelector('.cad-canvas-footer')!;
        const status = editor.querySelector('.cad-status')!;
        // Design has no machine demo bar: the former 64/96px reservation belongs to the canvas again.
        expect(parseFloat(getComputedStyle(editor).paddingBottom)).toBe(0);
        expect(
          canvas.getBoundingClientRect().bottom + canvasFooter.getBoundingClientRect().height + status.getBoundingClientRect().height
        ).toBeCloseTo(editor.getBoundingClientRect().bottom, 1);
        expect(noticeBounds.bottom).toBeLessThan(measurementBounds.top);
        const x = measurementBounds.x + measurementBounds.width / 2;
        const y = measurementBounds.y + measurementBounds.height / 2;
        expect(document.elementFromPoint(x, y)?.closest('.cad-selection-readout')).toBe(readout);
      });
    }
  }, 30_000);
});

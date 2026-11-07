import { addConic, addLine, createCadDocument, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor, type CadEditorController } from './CadEditor';
import { endCadSession } from './session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
async function setup(onFinish = vi.fn<(document: CadDocument) => void | Promise<void>>(), source = createPlateDocument()) {
  const document = source,
    controller = { current: null as CadEditorController | null };
  ids.push(document.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} controller={controller} onDraftChange={() => {}} onFinish={onFinish} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  return { controller, onFinish, document, canvas: screen.getByTestId('cad-canvas') as unknown as SVGSVGElement };
}

it.each(['toolbar', 'stage'] as const)(
  'applies a valid open dimension before %s Finish',
  async action => {
    const { controller, onFinish } = await setup();
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Width mm' }), '140');
    if (action === 'toolbar') await userEvent.click(screen.getByRole('button', { name: /Finish sketch/ }));
    else expect(await controller.current!.finish()).toBe(true);
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1), { timeout: 20_000 });
    expect(onFinish.mock.calls[0]![0].parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({ value: 140 });
  },
  30_000
);

it('blocks Finish on an invalid open dimension and retains it for correction', async () => {
  const { controller, onFinish } = await setup();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
  const input = screen.getByRole('textbox', { name: 'Width mm' });
  await userEvent.fill(input, '1,000');
  expect(await controller.current!.finish()).toBe(false);
  expect(onFinish).not.toHaveBeenCalled();
  expect(input).toHaveValue('1,000');
  expect(document.activeElement).toBe(input);
  await waitFor(() => expect(screen.getAllByText(/Ambiguous comma group/).length).toBeGreaterThan(0));
}, 30_000);

it('applies a typed creation value before Finish without inventing untyped dimensions', async () => {
  const source = createCadDocument();
  source.parts.push(createCadPart());
  const { controller, onFinish, canvas } = await setup(undefined, source);
  const click = async (x: number, y: number) => {
    const point = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    const bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: point.x - bounds.left, y: point.y - bounds.top } });
  };
  await userEvent.keyboard('g');
  await click(20, 20);
  await click(100, 60);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Rectangle width:/ })).toBeDefined());
  await userEvent.keyboard('60');
  expect(screen.getByRole('textbox', { name: 'Rectangle width value' })).toHaveValue('60');
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  expect(await controller.current!.finish()).toBe(true);
  const constraints = onFinish.mock.calls[0]![0].parts[0]!.sketch.constraints;
  expect(constraints.find(c => c.type === 'distanceX')).toMatchObject({ value: 60 });
  expect(constraints.some(c => c.type === 'distanceY')).toBe(false);
}, 30_000);

it('applies a typed conic rho before Finish', async () => {
  const source = createCadDocument();
  const part = createCadPart();
  part.sketch = addConic(part.sketch, { start: { x: 20, y: 20 }, end: { x: 100, y: 20 }, control: { x: 60, y: 75 }, rho: 0.5 });
  part.sketch = addLine(part.sketch, { x1: 100, y1: 20, x2: 20, y2: 20 });
  source.parts.push(part);
  const { controller, onFinish } = await setup(undefined, source);
  await userEvent.dblClick(screen.getByRole('button', { name: 'Edit conic rho: 0.5' }));
  await userEvent.fill(screen.getByRole('textbox', { name: 'Conic rho' }), '0.7');
  expect(await controller.current!.finish()).toBe(true);
  expect(onFinish.mock.calls[0]![0].parts[0]!.sketch.entities.find(e => e.type === 'conic')).toMatchObject({ rho: 0.7 });
}, 30_000);

it('shares a successful Finish with stage navigation controllers', async () => {
  const { controller, onFinish, document } = await setup();
  expect(await controller.current!.finish()).toBe(true);
  expect(onFinish).toHaveBeenCalledTimes(1);
  expect(onFinish.mock.calls[0]![0].id).toBe(document.id);
});

it('retains an incomplete drawing command when a stage requests Finish', async () => {
  const { controller, onFinish, canvas } = await setup();
  await userEvent.keyboard('g');
  const p = new DOMPoint(160, -20).matrixTransform(canvas.getScreenCTM()!),
    bounds = canvas.getBoundingClientRect();
  await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
  expect(await controller.current!.finish()).toBe(false);
  expect(onFinish).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText('Complete the current shape or press Escape before finishing the sketch.')).toBeDefined());
  expect(canvas.classList.contains('cad-tool-rectangle')).toBe(true);
});

it('reports acceptance failure without accepting the edit session', async () => {
  const onFinish = vi.fn<(document: CadDocument) => Promise<void>>().mockRejectedValue(new Error('Open profile.'));
  const { controller } = await setup(onFinish);
  expect(await controller.current!.finish()).toBe(false);
  await waitFor(() => expect(screen.getByText('Open profile.')).toBeDefined());
});

it('serializes concurrent requests through the single Finish boundary', async () => {
  let release!: () => void;
  const onFinish = vi.fn<(document: CadDocument) => Promise<void>>(
    () =>
      new Promise(resolve => {
        release = resolve;
      })
  );
  const { controller } = await setup(onFinish);
  const first = controller.current!.finish();
  expect(await controller.current!.finish()).toBe(false);
  expect(onFinish).toHaveBeenCalledTimes(1);
  release();
  expect(await first).toBe(true);
});

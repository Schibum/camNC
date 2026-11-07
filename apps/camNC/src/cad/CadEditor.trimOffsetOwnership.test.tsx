import { addCircle, addPoint, createCadDocument, createCadPart, offsetSketch, type CadDocument, type CadSketch } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const settled = () =>
  waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );

it('trims an Offset circle copy through a real pointer and restores its circle and relation with one Undo', async () => {
  let sketch = addCircle(createCadPart().sketch, { x: 60, y: 60, radius: 20, dimensioned: true, positioned: true });
  const circle = sketch.entities.find(e => e.type === 'circle')!;
  const copied = offsetSketch(sketch, { entityIds: [circle.id], value: 5 });
  if (!copied.ok) throw Error(copied.message);
  const copyId = copied.entityIds[0]!;
  sketch = addPoint(addPoint(copied.sketch, { x: 45, y: 60 }), { x: 75, y: 60 });
  const source = createCadDocument('Offset trim pointer ownership');
  source.parts.push({ ...createCadPart(), sketch });
  sessions.push(source.id);
  const changed = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={changed} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = (): CadSketch => changed.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? sketch;
  const before = structuredClone(latest());
  const p = new DOMPoint(60, -75).matrixTransform(canvas.getScreenCTM()!),
    bounds = canvas.getBoundingClientRect();
  await userEvent.keyboard('m');
  await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
  await settled();
  expect(latest().entities.find(e => e.id === copyId)).toMatchObject({ type: 'arc', radius: 15 });
  expect(latest().constraints.some(c => c.id === copied.dimensionId)).toBe(false);
  expect(latest().entities.find(e => e.id === circle.id)).toEqual(before.entities.find(e => e.id === circle.id));
  expect(document.querySelector('.cad-problems')?.textContent ?? '').not.toMatch(/offset needs|invalid reference|constraints conflict/i);
  expect(canvas.closest('.cad-editor')!.contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('{Control>}z{/Control}');
  await settled();
  expect(latest().entities.find(e => e.id === copyId)).toEqual(before.entities.find(e => e.id === copyId));
  expect(latest().constraints.find(c => c.id === copied.dimensionId)).toEqual(before.constraints.find(c => c.id === copied.dimensionId));
  expect(latest().entities.find(e => e.id === circle.id)).toEqual(before.entities.find(e => e.id === circle.id));
});

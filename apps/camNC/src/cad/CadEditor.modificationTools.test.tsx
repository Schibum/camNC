import {
  addCircle,
  addConstraint,
  addLine,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  type CadDocument,
  type CadSketch,
} from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.splice(0).forEach(endCadSession);
});
const checked = () =>
  waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );

async function setup(source: CadDocument) {
  const change = vi.fn<(document: CadDocument) => void>();
  ids.push(source.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await checked();
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const click = async (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
    await checked();
  };
  const latest = () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? source.parts[0]!.sketch;
  return { canvas, click, latest };
}
function lineEnds(sketch: CadSketch, id: string) {
  const line = sketch.entities.find(e => e.id === id);
  if (line?.type !== 'line') throw new Error('Expected line');
  return [line.startId, line.endId].map(id => sketch.entities.find(e => e.id === id && e.type === 'point'));
}

describe('modification tools through real pointer and keyboard input', () => {
  it('updates the offset unit hint live without committing incomplete expressions', async () => {
    const { canvas, click, latest } = await setup(createPlateDocument({ width: 100, height: 60 }));
    await click(50, 60);
    await userEvent.keyboard('o');
    await userEvent.click(screen.getByRole('button', { name: 'Edit offset distance' }));
    const input = screen.getByRole('textbox', { name: 'Offset distance' }) as HTMLInputElement;
    for (const text of ['2mm', '2in', '1/2in', '(20+30)mm', '2mm+']) {
      await userEvent.fill(input, text);
      expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(document.activeElement).toBe(input);
      expect(latest().constraints.some(c => c.type === 'offset')).toBe(false);
    }
    await userEvent.fill(input, '2');
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
    await userEvent.keyboard('{Enter}');
    await checked();
    expect(latest().constraints.find(c => c.type === 'offset')).toMatchObject({ value: 2 });
    expect(document.activeElement).toBe(canvas);
  });

  it('updates the fillet unit hint live and restores it for a plain radius', async () => {
    const { canvas, click, latest } = await setup(createPlateDocument({ width: 100, height: 60 }));
    await click(100, 60);
    await userEvent.keyboard('{Shift>}f{/Shift}');
    const input = screen.getByRole('textbox', { name: 'Fillet radius' }) as HTMLInputElement;
    for (const text of ['2mm', '2in', '1/2in', '(20+30)mm', '2mm+']) {
      await userEvent.fill(input, text);
      expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(document.activeElement).toBe(input);
      expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(0);
    }
    await userEvent.fill(input, '');
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
    expect(document.activeElement).toBe(input);
    expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(0);
    await userEvent.fill(input, '5');
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
    expect(document.activeElement).toBe(input);
    await userEvent.fill(input, '2mm');
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
    await userEvent.keyboard('{Enter}');
    await checked();
    expect(latest().entities.filter(e => e.type === 'arc')).toHaveLength(1);
    expect(latest().constraints.find(c => c.label === 'Fillet radius')).toMatchObject({ type: 'radius', value: 2 });
    expect(document.activeElement).toBe(canvas);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Fillet radius: 2 mm' }));
    const reopened = screen.getByRole('textbox', { name: 'Fillet radius mm' }) as HTMLInputElement;
    expect(reopened.value).toBe('2');
    expect(reopened.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
    expect(document.activeElement).toBe(reopened);
  });

  it('offsets all selected rectangle edges, edits the signed shared value and propagates source edits', async () => {
    const source = createPlateDocument({ width: 100, height: 60 });
    const { canvas, click, latest } = await setup(source);
    await click(50, 0);
    await userEvent.keyboard('{Shift>}');
    await click(100, 30);
    await click(50, 60);
    await click(0, 30);
    await userEvent.keyboard('{/Shift}o');
    expect(canvas.querySelectorAll('[data-modification-preview] [data-visible-curve]')).toHaveLength(4);
    await userEvent.keyboard('10{Enter}');
    await checked();
    const group = latest().constraints.find(c => c.type === 'offset');
    expect(group).toMatchObject({ type: 'offset', value: 10 });
    if (group?.type !== 'offset') throw new Error('Offset missing');
    expect(group.members).toHaveLength(4);
    expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(8);
    await userEvent.keyboard('{Escape}{Escape}');
    await userEvent.dblClick(screen.getByRole('button', { name: /^Edit Offset: 10 mm$/i }));
    await userEvent.keyboard('-5{Enter}');
    await checked();
    expect(latest().constraints.find(c => c.id === group.id)).toMatchObject({ value: -5 });
    const copies = group.members.flatMap(member => lineEnds(latest(), member.targetId));
    expect(copies.some(point => point?.type === 'point' && Math.abs(point.x + 5) < 1e-5)).toBe(true);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 100 mm' }));
    await userEvent.keyboard('120{Enter}');
    await checked();
    expect(
      group.members
        .flatMap(member => lineEnds(latest(), member.targetId))
        .some(point => point?.type === 'point' && Math.abs(point.x - 125) < 1e-5)
    ).toBe(true);
    await userEvent.keyboard('{Control>}z{/Control}');
    await checked();
    expect(latest().constraints.find(c => c.label === 'Width')).toMatchObject({ value: 100 });
    expect(latest().constraints.find(c => c.id === group.id)).toMatchObject({ value: -5 });
  });

  it('offsets a single selected edge without copying its whole rectangle, and cancels before any commit', async () => {
    const source = createPlateDocument({ width: 100, height: 60 });
    const { canvas, click, latest } = await setup(source);
    await click(50, 60);
    await userEvent.keyboard('o');
    expect(canvas.querySelectorAll('[data-modification-preview] [data-visible-curve]')).toHaveLength(1);
    expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(4);
    await userEvent.keyboard('{Escape}');
    expect(canvas.querySelector('[data-modification-preview]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
    expect(latest().constraints.some(c => c.type === 'offset')).toBe(false);
    await userEvent.keyboard('o');
    await click(50, 60);
    await userEvent.keyboard('8{Enter}');
    await checked();
    expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(5);
    expect(latest().constraints.find(c => c.type === 'offset')).toMatchObject({ value: 8 });
    await userEvent.keyboard('{Control>}z{/Control}');
    await checked();
    expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(4);
  });

  it('mirrors a picked circle about a construction line, then resizes both through D', async () => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 100, y1: 10, x2: 100, y2: 110, construction: true });
    part.sketch = addCircle(part.sketch, { x: 60, y: 60, radius: 20 });
    part.sketch.entities = part.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
    source.parts.push(part);
    const { click, latest } = await setup(source);
    await click(80, 60);
    const chooseMirror = async () => {
      const mirror = screen.queryByRole('button', { name: 'Mirror' });
      if (mirror) await userEvent.click(mirror);
      else {
        await userEvent.keyboard('s');
        await userEvent.click(screen.getByRole('button', { name: 'Mirror' }));
      }
    };
    await chooseMirror();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('group', { name: 'Mirror selection' })).toBeNull();
    expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(1);
    await click(80, 60);
    await chooseMirror();
    await click(100, 60);
    await userEvent.keyboard('{Escape}{Escape}');
    expect(latest().entities.filter(e => e.type === 'circle')).toHaveLength(2);
    await userEvent.keyboard('d');
    await click(80, 60);
    await click(40, 100);
    await userEvent.keyboard('25{Enter}');
    await checked();
    for (const circle of latest().entities.filter(e => e.type === 'circle')) expect(circle.radius).toBeCloseTo(12.5, 5);
    const centers = latest()
      .entities.filter(e => e.type === 'circle')
      .map(e => latest().entities.find(p => p.type === 'point' && p.id === e.centerId));
    expect(centers.map(point => (point?.type === 'point' ? Math.round(point.x * 1e5) / 1e5 : NaN)).sort((a, b) => a - b)).toEqual([
      60, 140,
    ]);
  });

  it('keeps the first Extend pick unchanged, extends to an off-axis boundary pick, and restores driver with Undo', async () => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 40, x2: 80, y2: 40 });
    const line = part.sketch.entities.find(e => e.type === 'line')!;
    part.sketch = addConstraint(part.sketch, {
      type: 'distance',
      pointAId: line.startId,
      pointBId: line.endId,
      value: 60,
      sourceEntityId: line.id,
      label: 'Length',
    });
    part.sketch = addLine(part.sketch, { x1: 120, y1: 10, x2: 120, y2: 90 });
    source.parts.push(part);
    const { canvas, click, latest } = await setup(source);
    await userEvent.keyboard('x');
    await click(75, 40);
    expect(lineEnds(latest(), line.id)).toEqual(expect.arrayContaining([expect.objectContaining({ x: 80, y: 40 })]));
    expect(canvas.querySelector('[data-modification-preview]')).toBeNull();
    expect(canvas.querySelector('[data-extend-endpoint="end"]')).not.toBeNull();
    await click(120, 60);
    expect(lineEnds(latest(), line.id)).toEqual(expect.arrayContaining([expect.objectContaining({ x: 120, y: 40 })]));
    expect(latest().constraints.some(c => c.label === 'Length')).toBe(false);
    expect(latest().constraints.some(c => c.type === 'pointOnLine')).toBe(true);
    await userEvent.keyboard('{Control>}z{/Control}');
    await checked();
    expect(lineEnds(latest(), line.id)).toEqual(expect.arrayContaining([expect.objectContaining({ x: 80, y: 40 })]));
    expect(latest().constraints.find(c => c.label === 'Length')).toMatchObject({ value: 60 });
  });
});

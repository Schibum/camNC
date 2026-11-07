import { createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
async function setup() {
  const source = createCadDocument();
  source.parts.push(createCadPart());
  ids.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? source.parts[0]!.sketch;
  const settle = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await settle();
  await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
  const client = (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      p.x = bounds.left + (p.x * bounds.width) / frame.innerWidth;
      p.y = bounds.top + (p.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return { x: p.x, y: p.y };
  };
  const mouse = cdp();
  const click = async (x: number, y: number) => {
    await mouse.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(x, y) });
    await mouse.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...client(x, y), button: 'left', buttons: 1, clickCount: 1 });
    await mouse.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...client(x, y), button: 'left', buttons: 0, clickCount: 1 });
  };
  const drag = async (x: number, y: number, tx: number, ty: number) => {
    await mouse.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(x, y) });
    await mouse.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...client(x, y), button: 'left', buttons: 1, clickCount: 1 });
    await mouse.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(tx, ty), button: 'left', buttons: 1 });
    await mouse.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...client(tx, ty), button: 'left', buttons: 0, clickCount: 1 });
    await settle();
  };
  return { canvas, latest, settle, drag, click };
}

it('offers passive line length after real release, accepts typed digits, and undoes the driver without deleting the line', async () => {
  const { canvas, latest, settle, drag } = await setup();
  await userEvent.keyboard('l');
  await drag(20, 20, 100, 20);
  expect(screen.getByRole('button', { name: /^Line length: 80 mm/ })).toBeTruthy();
  expect(document.activeElement).toBe(canvas);
  const line = latest().entities.find(entity => entity.type === 'line')!;
  await userEvent.keyboard('50');
  expect(screen.getByRole('textbox', { name: 'Line length value' })).toHaveValue('50');
  await userEvent.keyboard('{Enter}');
  await settle();
  expect(latest().constraints.find(c => c.type === 'distance')).toMatchObject({ value: 50, sourceEntityId: line.id });
  expect(screen.getByRole('button', { name: 'Line (L)' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(canvas);
  await userEvent.keyboard('{Control>}z{/Control}');
  await settle();
  expect(latest().entities.some(entity => entity.id === line.id)).toBe(true);
  expect(latest().constraints.some(c => c.type === 'distance')).toBe(false);
});

it('accepts rectangle width then height from actual keyboard input without stealing focus before typing', async () => {
  const { canvas, latest, settle, drag } = await setup();
  await userEvent.keyboard('g');
  await drag(20, 20, 100, 60);
  expect(screen.getByRole('button', { name: /^Rectangle width: 80 mm/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Rectangle height: 40 mm/ })).toBeTruthy();
  expect(document.activeElement).toBe(canvas);
  await userEvent.keyboard('60{Enter}');
  await settle();
  expect(document.activeElement).toBe(canvas);
  expect(screen.queryByRole('textbox', { name: 'Rectangle height value' })).toBeNull();
  await userEvent.keyboard('30{Enter}');
  await settle();
  expect(latest().constraints.find(c => c.type === 'distanceX')).toMatchObject({ value: 60 });
  expect(latest().constraints.find(c => c.type === 'distanceY')).toMatchObject({ value: 30 });
  expect(screen.getByRole('button', { name: 'Corner rectangle (G)' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(canvas);
});

it('creates a driving diameter from a fractional inch expression after a real circle drag', async () => {
  const { canvas, latest, settle, drag } = await setup();
  await userEvent.keyboard('c');
  await drag(80, 70, 100, 70);
  expect(screen.getByRole('button', { name: /^Circle diameter: 40 mm/ })).toBeTruthy();
  expect(document.activeElement).toBe(canvas);
  await userEvent.keyboard('1/2 in');
  const input = screen.getByRole('textbox', { name: 'Circle diameter value' }) as HTMLInputElement;
  expect(input.value).toBe('1/2 in');
  expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
  await userEvent.fill(input, '');
  expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
  expect(document.activeElement).toBe(input);
  await userEvent.fill(input, '1/2 in');
  expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
  await userEvent.keyboard('{Enter}');
  await settle();
  expect(latest().constraints.find(c => c.type === 'diameter')).toMatchObject({ value: 12.7, expression: '1/2 in' });
  expect(latest().entities.find(entity => entity.type === 'circle')).toMatchObject({ radius: expect.closeTo(6.35, 6) });
  expect(document.activeElement).toBe(canvas);
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
  await userEvent.dblClick(screen.getByRole('button', { name: 'Edit diameter: 12.7 mm' }));
  const reopened = screen.getByRole('textbox', { name: 'diameter mm' }) as HTMLInputElement;
  expect(reopened.value).toBe('1/2 in');
  expect(reopened.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
  expect(document.activeElement).toBe(reopened);
});

it('can accept the measured default with Enter or use the next shortcut while the value is passive', async () => {
  const { latest, settle, drag } = await setup();
  await userEvent.keyboard('c');
  await drag(80, 70, 100, 70);
  await userEvent.keyboard('{Enter}');
  await settle();
  expect(latest().constraints.find(c => c.type === 'diameter')).toMatchObject({ value: expect.closeTo(40, 3) });
  await drag(150, 70, 160, 70);
  await userEvent.keyboard('l');
  expect(screen.getByRole('button', { name: 'Line (L)' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: /^Circle diameter:/ })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Circle diameter value' })).toBeNull();
});

it('parses arithmetic and units through the actual placed dimension field while keeping full edit precision', async () => {
  const { latest, settle, drag, click } = await setup();
  await userEvent.keyboard('l');
  await drag(20, 20, 100, 20);
  await userEvent.keyboard('{Escape}{Escape}d');
  await click(60, 20);
  await click(60, 5);
  const input = screen.getByRole('textbox', { name: 'Length mm' });
  await userEvent.fill(input, '20+30');
  await userEvent.keyboard('{Enter}');
  await settle();
  const dimension = latest().constraints.find(c => c.label === 'Length' && 'value' in c)!;
  expect(dimension).toMatchObject({ value: 50, expression: '20+30' });
  const label = screen.getByRole('button', { name: /^Edit Length:/ });
  await userEvent.dblClick(label);
  expect(screen.getByRole('textbox', { name: 'Length mm' })).toHaveValue('20+30');
  await userEvent.fill(screen.getByRole('textbox', { name: 'Length mm' }), '10 cm');
  await userEvent.keyboard('{Enter}');
  await settle();
  expect(latest().constraints.find(c => c.id === dimension.id)).toMatchObject({ value: 100, expression: '10 cm' });
});

it('updates a placed dimension unit hint while typing and reopening a converted expression', async () => {
  const { latest, settle, drag, click } = await setup();
  await userEvent.keyboard('l');
  await drag(20, 20, 100, 20);
  await userEvent.keyboard('{Escape}{Escape}d');
  await click(60, 20);
  await click(60, 5);
  const input = screen.getByRole('textbox', { name: 'Length mm' }) as HTMLInputElement;
  const suffix = () => input.parentElement!.querySelector('[aria-hidden="true"]');
  for (const text of ['2mm', '2in', '1/2in', '(20+30)mm', '2mm+']) {
    await userEvent.fill(input, text);
    expect(suffix()).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(text);
  }
  await userEvent.fill(input, '50');
  expect(suffix()?.textContent).toBe('mm');
  await userEvent.fill(input, '2in');
  await userEvent.keyboard('{Enter}');
  await settle();
  expect(latest().constraints.find(c => c.label === 'Length')).toMatchObject({ value: 50.8, expression: '2in' });
  await userEvent.dblClick(screen.getByRole('button', { name: /^Edit Length:/ }));
  const reopened = screen.getByRole('textbox', { name: 'Length mm' }) as HTMLInputElement;
  expect(reopened.value).toBe('2in');
  expect(reopened.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
  expect(document.activeElement).toBe(reopened);
});

it('updates completed rectangle creation hints without losing focus or the next dimension step', async () => {
  const { canvas, latest, settle, drag } = await setup();
  await userEvent.keyboard('g');
  await drag(20, 20, 100, 60);
  await userEvent.click(screen.getByRole('button', { name: /^Rectangle width: 80 mm/ }));
  const input = screen.getByRole('textbox', { name: 'Rectangle width value' }) as HTMLInputElement;
  for (const text of ['2mm', '2in', '1/2in', '(20+30)mm', '2mm+']) {
    await userEvent.fill(input, text);
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(document.activeElement).toBe(input);
  }
  await userEvent.fill(input, '');
  expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
  expect(document.activeElement).toBe(input);
  await userEvent.fill(input, '60');
  expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
  await userEvent.keyboard('{Enter}');
  await settle();
  expect(document.activeElement).toBe(canvas);
  await userEvent.click(screen.getByRole('button', { name: /^Rectangle height: 40 mm/ }));
  const height = screen.getByRole('textbox', { name: 'Rectangle height value' });
  await userEvent.fill(height, '30mm');
  expect(height.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
  await userEvent.keyboard('{Enter}');
  await settle();
  expect(latest().constraints.find(c => c.type === 'distanceX')).toMatchObject({ value: 60 });
  expect(latest().constraints.find(c => c.type === 'distanceY')).toMatchObject({ value: 30 });
  expect(document.activeElement).toBe(canvas);
  await userEvent.keyboard('{Escape}');
  const width = latest().constraints.find(c => c.type === 'distanceX')!;
  await userEvent.dblClick(screen.getByRole('button', { name: `Edit ${width.label}: 60 mm` }));
  const reopened = screen.getByRole('textbox', { name: `${width.label} mm` }) as HTMLInputElement;
  expect(reopened.value).toBe('60');
  expect(reopened.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
  expect(document.activeElement).toBe(reopened);
});

it.each(['rectangle', 'circle'] as const)('updates the pending %s size fields independently while typing', async tool => {
  const { click, latest, settle } = await setup();
  await userEvent.keyboard(tool === 'rectangle' ? 'g' : 'c');
  await click(20, 20);
  const labels = tool === 'rectangle' ? ['Rectangle width', 'Rectangle height'] : ['Circle radius'];
  for (const label of labels) {
    const input = screen.getByRole('textbox', { name: label }) as HTMLInputElement;
    await userEvent.fill(input, '1/2in');
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(document.activeElement).toBe(input);
    await userEvent.fill(input, '');
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
    expect(document.activeElement).toBe(input);
    await userEvent.fill(input, '25');
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('mm');
    expect(document.activeElement).toBe(input);
  }
  if (tool === 'rectangle') {
    await userEvent.fill(screen.getByRole('textbox', { name: 'Rectangle width' }), '2in');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Rectangle height' }), '1/2in');
  } else await userEvent.fill(screen.getByRole('textbox', { name: 'Circle radius' }), '1/2in');
  await userEvent.click(screen.getByRole('button', { name: /^Create$/ }));
  await settle();
  await userEvent.keyboard('{Escape}{Escape}');
  if (tool === 'rectangle') {
    expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(4);
    expect(latest().constraints.find(c => c.label === 'Width')).toMatchObject({ value: 50.8, expression: '2in' });
    expect(latest().constraints.find(c => c.label === 'Height')).toMatchObject({ value: 12.7, expression: '1/2in' });
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 50.8 mm' }));
    const reopened = screen.getByRole('textbox', { name: 'Width mm' }) as HTMLInputElement;
    expect(reopened.value).toBe('2in');
    expect(reopened.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(document.activeElement).toBe(reopened);
  } else {
    expect(latest().entities.find(e => e.type === 'circle')).toMatchObject({ radius: expect.closeTo(12.7, 6) });
    expect(latest().constraints.find(c => c.type === 'diameter')).toMatchObject({ value: 25.4, expression: '2*(1/2in)' });
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Diameter: 25.4 mm' }));
    const reopened = screen.getByRole('textbox', { name: 'Diameter mm' }) as HTMLInputElement;
    expect(reopened.value).toBe('2*(1/2in)');
    expect(reopened.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(document.activeElement).toBe(reopened);
  }
});

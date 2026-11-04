import { camWorker } from '@/cam/camQueries';
import { getJob, createJob, saveJob } from '@/cam/jobDb';
import * as Comlink from 'comlink';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
// The app's styles: the phone layout test measures real boxes.
import '@/style.css';
import { page } from '@vitest/browser/context';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import otherStepUrl from '../../../../../packages/cam/test/fixtures/besteckkasten.step?url';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.model';

const params = vi.hoisted(() => ({ jobId: '' }));
const picked = vi.hoisted(() => ({ file: null as File | null }));
vi.mock('@/cam/openModelFile', async importOriginal => ({
  ...(await importOriginal<typeof import('@/cam/openModelFile')>()),
  pickModelFile: async () => picked.file,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useNavigate: () => () => undefined,
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
// WebGL is not what this test is about.
vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: () => <div data-testid="viewport" /> }));

const ModelStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

// Loading the CAD kernel (occt wasm, ~2.3 MB) and compiling it is the slow part of the first import, slower still on a
// loaded CI runner: do it once up front, so the tests below measure the Model step, not the kernel's cold start.
beforeAll(async () => {
  const bytes = new Uint8Array(await (await fetch(stepUrl)).arrayBuffer());
  await camWorker().importModel(Comlink.transfer(bytes, [bytes.buffer]), 'warm-up.step', 'warm-up');
}, 120_000);

describe('CAM model step', () => {
  it('reads a STEP model in seconds once the CAD kernel is loaded', async () => {
    const bytes = new Uint8Array(await (await fetch(stepUrl)).arrayBuffer());
    const t0 = performance.now();
    const model = await camWorker().importModel(Comlink.transfer(bytes, [bytes.buffer]), 'timed.step', 'timed');
    expect(model.parts.length).toBeGreaterThan(0);
    // ~2 s here; generous for a busy CI runner.
    expect(performance.now() - t0).toBeLessThan(20_000);
  }, 60_000);

  it('lists the parts of a STEP model grouped by thickness, and saves "Mill this part"', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelStep />
      </QueryClientProvider>
    );

    const thick = await screen.findByRole('region', { name: '8 mm boards' }, { timeout: 60_000 });
    expect(within(thick).getByText('8 mm · 5 parts')).toBeTruthy();
    for (const name of ['left', 'right', 'Part 1', 'Part 2']) expect(within(thick).getByText(name)).toBeTruthy();
    expect(within(thick).getByText('× 2')).toBeTruthy();
    expect(within(thick).getAllByText('9 pockets 4.2 deep')).toHaveLength(2);
    const thin = screen.getByRole('region', { name: '3 mm boards' });
    expect(within(thin).getByText('back')).toBeTruthy();

    fireEvent.click(within(thin).getByRole('button', { name: /^back/ }));
    expect(screen.getByRole('heading', { name: 'back' })).toBeTruthy();
    expect(screen.getByLabelText('Mill this part').getAttribute('aria-describedby')).toBe('mill-part-hint');
    expect(document.getElementById('mill-part-hint')!.textContent).toMatch(/stays out of the boards/);
    fireEvent.click(screen.getByLabelText('Mill this part'));
    const notMilled = screen.getByRole('region', { name: 'Not milled' });
    await waitFor(() => expect(within(notMilled).getByText('back')).toBeTruthy());
    await waitFor(async () => expect((await getJob(job.id))?.parts.find(p => p.name === 'back')?.milled).toBe(false));
  }, 90_000);

  it('replacing the model with a file of the same name reads the new one, without a reload', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'model.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelStep />
      </QueryClientProvider>
    );
    await screen.findByRole('region', { name: '8 mm boards' }, { timeout: 60_000 });
    // The sizes of the parts: the geometry, whatever they are called (names stay with the job, by part id).
    const sizes = () => screen.queryAllByText(/^\d+(\.\d+)? × \d+(\.\d+)?$/).map(e => e.textContent);
    const before = sizes();
    expect(before.length).toBeGreaterThan(0);

    picked.file = new File([await (await fetch(otherStepUrl)).arrayBuffer()], 'model.step');
    fireEvent.click(screen.getByRole('button', { name: 'Replace model…' }));
    await waitFor(
      () => {
        expect(sizes().length).toBeGreaterThan(0);
        expect(sizes()).not.toEqual(before);
      },
      { timeout: 60_000 }
    );
    expect((await getJob(job.id))?.modelRevision).toBe(1);
  }, 120_000);

  it('names each identical body, and renames a part in place', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelStep />
      </QueryClientProvider>
    );
    const thick = await screen.findByRole('region', { name: '8 mm boards' }, { timeout: 60_000 });
    fireEvent.click(within(thick).getByRole('button', { name: /^Part 1/ }));
    // The two identical shelves are "Part 1" and "Part 3" in the STEP: one name per body, as on Boards and Plan.
    expect(screen.getByText('Part 1a, Part 1b')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Part 1' }));
    const input = screen.getByRole('textbox', { name: 'Part name' });
    fireEvent.change(input, { target: { value: 'Shelf' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Shelf/ })).toBeTruthy());
    expect(screen.getByText('Shelf a, Shelf b')).toBeTruthy();
    expect(within(thick).getByText('Shelf')).toBeTruthy();
    await waitFor(async () => expect((await getJob(job.id))?.parts.map(p => p.name)).toContain('Shelf'));

    // Escape keeps the name.
    fireEvent.click(screen.getByRole('button', { name: 'Rename Shelf' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Part name' }), { target: { value: 'nope' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Part name' }), { key: 'Escape' });
    expect(screen.getByRole('heading', { name: /^Shelf/ })).toBeTruthy();
  }, 90_000);

  it('renames a part from its card in the list, by its menu or a double-click, like the inspector', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelStep />
      </QueryClientProvider>
    );
    const thin = await screen.findByRole('region', { name: '3 mm boards' }, { timeout: 60_000 });
    expect(screen.getByText('6 bodies · 6 milled')).toBeTruthy();
    // One way on: the header's "Next: Boards", no second button in the inspector.
    expect(screen.queryByRole('button', { name: 'Arrange on boards' })).toBeNull();

    // ⋯ › Rename…
    fireEvent.pointerDown(within(thin).getByRole('button', { name: 'More for back' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    // Right away, and not hidden by the closing menu (a modal one hides the rest of the page until it's gone).
    const input = within(thin).getByRole('textbox', { name: 'New name for back' });
    fireEvent.change(input, { target: { value: 'Back panel' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(within(thin).getByText('Back panel')).toBeTruthy());
    await waitFor(async () => expect((await getJob(job.id))?.parts.map(p => p.name)).toContain('Back panel'));

    // Double-click on the name; Escape keeps it.
    fireEvent.doubleClick(within(thin).getByText('Back panel'));
    const again = within(thin).getByRole('textbox', { name: 'New name for Back panel' });
    fireEvent.change(again, { target: { value: 'nope' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(within(thin).queryByRole('textbox')).toBeNull();
    expect(within(thin).getByText('Back panel')).toBeTruthy();

    // Empty: back to the model's name.
    fireEvent.doubleClick(within(thin).getByText('Back panel'));
    const cleared = within(thin).getByRole('textbox', { name: 'New name for Back panel' });
    fireEvent.change(cleared, { target: { value: '' } });
    fireEvent.blur(cleared);
    await waitFor(() => expect(within(thin).getByText('back')).toBeTruthy());
  }, 90_000);

  it('disables "Next: Boards" with the reason when no part is milled', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelStep />
      </QueryClientProvider>
    );
    await screen.findByRole('region', { name: '8 mm boards' }, { timeout: 60_000 });
    expect(screen.queryByRole('button', { name: 'Next: Boards' })).toBeNull();
    // Every part unticked (as saved by the Model step).
    await waitFor(async () => expect((await getJob(job.id))?.parts.length).toBeGreaterThan(0));
    cleanup();
    const saved = (await getJob(job.id))!;
    await saveJob({ ...saved, parts: saved.parts.map(p => ({ ...p, milled: false })) });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelStep />
      </QueryClientProvider>
    );
    await screen.findByRole('region', { name: 'Not milled' }, { timeout: 60_000 });
    const next = await screen.findByRole('button', { name: 'Next: Boards' });
    expect(next.hasAttribute('disabled')).toBe(true);
    const reason = next.getAttribute('aria-describedby')!;
    expect(document.getElementById(reason)!.textContent).toMatch(/No part is milled/);
    expect(screen.getByText('6 bodies · 0 milled')).toBeTruthy();
  }, 90_000);

  it('stacks the panels in normal flow at phone width', async () => {
    await page.viewport(390, 844);
    try {
      const bytes = await (await fetch(stepUrl)).arrayBuffer();
      const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
      params.jobId = job.id;
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ModelStep />
        </QueryClientProvider>
      );
      await screen.findByRole('region', { name: '8 mm boards' }, { timeout: 60_000 });
      expect(window.innerWidth).toBe(390);
      const list = screen.getByRole('heading', { name: 'Parts' }).closest('aside')!;
      const view = screen.getByRole('group', { name: 'View' });
      // The whole list shows, and ends before the 3D view starts, instead of being cut off under it.
      expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight + 1);
      expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(view.getBoundingClientRect().top);
      // "As modeled" / "Laid flat" stay on one line each.
      for (const b of within(view).getAllByRole('button')) expect(b.getBoundingClientRect().height).toBeLessThanOrEqual(34);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      await page.viewport(1280, 800);
    }
  }, 90_000);

  it('says in plain words that a broken STEP file could not be read, marks the job, and disables Next', async () => {
    const job = await createJob(new File(["ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n"], 'broken.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelStep />
      </QueryClientProvider>
    );
    const alert = await screen.findByRole('alert', {}, { timeout: 60_000 });
    expect(alert.textContent).toMatch(
      /broken\.step could not be read: the STEP file may be damaged.*Export it again from your CAD program as STEP/
    );
    expect(alert.textContent).not.toMatch(/occt/);
    expect(screen.getByRole('button', { name: 'Next: Boards' }).hasAttribute('disabled')).toBe(true);
    expect(within(alert).getByRole('button', { name: 'Delete job' })).toBeTruthy();
    await waitFor(async () => expect((await getJob(job.id))?.readError).toMatch(/could not be read/));
  }, 90_000);
});

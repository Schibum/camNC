import { instancesOf, reconcileBoards, type BoardV1 } from '@/cam/boards';
import { camWorker, modelKey } from '@/cam/camQueries';
import type { PlanResult } from '@/cam/camTypes';
import { createJob, saveJob } from '@/cam/jobDb';
import { useCamMachine } from '@/cam/machine/camMachine';
import { usePlanLayout } from '@/cam/plan/planLayoutStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Comlink from 'comlink';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import besteckUrl from '../../../../../packages/cam/test/fixtures/besteckkasten.step?url';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.plan';

const params = vi.hoisted(() => ({ jobId: '' }));
/** Changes what the plans come back as, and keeps the last ones. */
const plans = vi.hoisted(() => ({ tamper: (p: unknown) => p, last: [] as unknown[] }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/cam/camQueries', async importOriginal => {
  const real = await importOriginal<typeof import('@/cam/camQueries')>();
  return {
    ...real,
    useBoardPlans: (...args: Parameters<typeof real.useBoardPlans>) =>
      real.useBoardPlans(...args).map((r, i) => {
        const data = r.data && plans.tamper(r.data);
        plans.last[i] = data;
        return { ...r, data };
      }),
  };
});

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(() => {
  cleanup();
  plans.tamper = p => p;
  plans.last = [];
  usePlanLayout.setState(usePlanLayout.getInitialState(), true);
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  localStorage.removeItem('camnc-plan-layout');
  localStorage.removeItem('camnc-cam-machine');
});

/** The model with the first board changed, on the Plan step. */
async function open(url: string, fileName: string, change: (b: BoardV1) => BoardV1) {
  const bytes = await (await fetch(url)).arrayBuffer();
  const job = await createJob(new File([bytes], fileName));
  const copy = new Uint8Array(bytes.slice(0));
  const model = await camWorker().importModel(Comlink.transfer(copy, [copy.buffer]), job.fileName, modelKey(job));
  const boards = reconcileBoards(
    undefined,
    instancesOf(model.parts, () => true),
    'oak'
  ).map(b => (b.name === 'A' ? change(b) : b));
  await saveJob({ ...job, boards });
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PlanStep />
    </QueryClientProvider>
  );
}

const opList = () => screen.findByRole('list', { name: 'Operations for board A' }, { timeout: 60_000 });
const row = (list: HTMLElement, name: RegExp) =>
  within(list)
    .getAllByRole('listitem')
    .find(li => name.test(li.textContent!));
const operationsTab = () =>
  within(screen.getByRole('tablist', { name: 'Operations and settings' })).getByRole('tab', { name: /^Operations/ });
const fmtMin = (m: number) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;

describe('CAM plan step, the guided programs after the cutting', () => {
  it('free parts: its own row after the cutting, pauses on the timeline, and the job time includes it', async () => {
    await open(stepUrl, 'kinderregal-eiche.step', b => ({ ...b, holdDown: 'skin', holdPoints: [] }));
    const list = await opList();
    const items = within(list).getAllByRole('listitem');
    // Last, one row for all the laps.
    expect(items.at(-1)!.textContent).toMatch(/After the cutting.*Free the parts.*⌀3\.175 · \d+:\d\d sim.*5 pauses: take out each part/);
    expect(items.filter(li => li.textContent!.includes('Free'))).toHaveLength(1);

    const view = screen.getByRole('region', { name: /^3D view of board/ });
    expect(within(view).getAllByRole('img', { name: /^Pause: Take out / })).toHaveLength(5);
    // A band per lap, in the row's colour, and selecting the row frames them.
    fireEvent.click(within(items.at(-1)!).getAllByRole('button')[0]);
    expect(within(view).getByText(/^Free the parts: solid where it has cut/)).toBeTruthy();
    expect(within(items.at(-1)!).getByText(/without the pauses/)).toBeTruthy();

    const a = plans.last[0] as PlanResult;
    const b = plans.last[1] as PlanResult;
    const [free] = a.release!;
    expect(free.kind).toBe('free');
    expect(free.pauses).toBe(5);
    expect(free.turned).toBe(false);
    expect(free.safety).toEqual([]);
    expect(free.gcode.match(/^M0 \(MSG Take out /gm)).toHaveLength(5);
    // Cut through: from the skin down to the through-cut depth.
    expect(free.ops[0].zBottom).toBeCloseTo(-0.3);
    await waitFor(() => expect(plans.last[1]).toBeTruthy(), { timeout: 60_000 });
    const total = a.timeMin + free.timeMin + ((plans.last[1] as PlanResult)?.timeMin ?? b.timeMin);
    await waitFor(() => expect(screen.getByText(/Job: 2 boards/).textContent).toContain(`${fmtMin(total)} min cutting`), {
      timeout: 60_000,
    });
  }, 120_000);

  it('tab removal follows "Pause after each tab": changing it plans again', async () => {
    await open(stepUrl, 'kinderregal-eiche.step', b => ({ ...b, holdDown: 'tabs-guided' }));
    const list = await opList();
    const tabs = () => row(screen.getByRole('list', { name: 'Operations for board A' }), /Remove the tabs/)!;
    const n = (plans.last[0] as PlanResult).release![0].tabs!.length;
    expect(tabs().textContent).toContain(`${n} pauses: hold the part at each tab`);
    expect(within(screen.getByRole('region', { name: /^3D view of board/ })).getAllByRole('img', { name: /^Pause: Tab \d/ })).toHaveLength(
      n
    );
    expect(list).toBeTruthy();
    fireEvent.click(within(tabs()).getAllByRole('button')[0]);
    fireEvent.click(within(tabs()).getByRole('checkbox', { name: 'Pause after each tab' }));
    expect(useCamMachine.getState().pauseEachTab).toBe(false);
    await waitFor(() => expect(tabs().textContent).toContain('5 pauses: take out each part'), { timeout: 30_000 });
    const planned = (plans.last[0] as PlanResult).release![0];
    expect(planned.perPart).toBe(true);
    expect(planned.gcode.match(/^M0 \(MSG Take out /gm)).toHaveLength(5);
    expect(planned.gcode).not.toMatch(/^M0 \(MSG Tab /m);
  }, 120_000);

  it('taped down: the layer on the tape is planned too, no pauses', async () => {
    await open(stepUrl, 'kinderregal-eiche.step', b => ({ ...b, holdDown: 'fixture-tape', boardHold: 'tape', holdPoints: [] }));
    const list = await opList();
    expect(row(list, /Cut free/)!.textContent).toContain('No pauses: take the parts off the tape at the end');
    expect(within(screen.getByRole('region', { name: /^3D view of board/ })).queryAllByRole('img', { name: /^Pause: / })).toHaveLength(0);
    const [cut] = (plans.last[0] as PlanResult).release!;
    expect(cut.pauses).toBe(0);
    expect(cut.safety).toEqual([]);
  }, 120_000);

  it('a flipped board: on side B, the board turned over, cutting from the new top; checked against that', async () => {
    await open(besteckUrl, 'besteckkasten.step', b => ({
      ...b,
      holdDown: 'skin',
      holdPoints: [],
      size: { fit: false as const, w: 1220, h: 610 },
    }));
    const sides = await screen.findByRole('group', { name: 'Board side' }, { timeout: 90_000 });
    // Side A: not yet.
    expect(row(await opList(), /Free the parts/)).toBeUndefined();
    fireEvent.click(within(sides).getByRole('button', { name: 'Side B (turned over)' }));
    await waitFor(() => expect(row(screen.getByRole('list', { name: 'Operations for board A' }), /Free the parts/)).toBeTruthy());

    const a = plans.last[0] as PlanResult;
    const [free] = a.release!;
    expect(free.turned).toBe(true);
    const [, , top] = a.size;
    // From the new top through the 1 mm skin, 0.3 past it: nowhere near the spoilboard.
    expect(free.ops[0].zBottom).toBeCloseTo(top - 1 - 0.3);
    expect(free.safety).toEqual([]);
    expect(screen.getByText(/Safety checks passed/)).toBeTruthy();
  }, 150_000);

  it('a guided program that breaks a safety rule blocks the job and flags the Operations tab; warnings get an amber mark', async () => {
    plans.tamper = p => {
      const plan = p as PlanResult;
      return { ...plan, release: plan.release?.map(r => ({ ...r, safety: ['Free the parts: move to Z-9 is below -0.3'] })) };
    };
    await open(stepUrl, 'kinderregal-eiche.step', b => ({ ...b, holdDown: 'skin', holdPoints: [] }));
    await opList();
    expect(screen.getByText('Free the parts: move to Z-9 is below -0.3')).toBeTruthy();
    expect(screen.queryByText(/Safety checks passed/)).toBeNull();
    expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', true);
    // Red from the Settings tab too.
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Operations and settings' })).getByRole('tab', { name: 'Settings' }));
    expect(operationsTab().querySelector('[data-mark]')!.getAttribute('data-mark')).toBe('problem');
    expect(operationsTab().textContent).toContain('(a check failed)');
    cleanup();

    // Nothing broken, but warnings: amber. Nothing at all: no mark.
    plans.tamper = p => ({ ...(p as PlanResult), warnings: ['Small sloped faces'], timeline: [], hold: [] });
    await open(stepUrl, 'kinderregal-eiche.step', b => b);
    // Still on the Settings tab: remembered.
    await within(await screen.findByRole('tablist', { name: 'Operations and settings' }, { timeout: 60_000 })).findByRole('tab', {
      name: /^Operations/,
    });
    await waitFor(() => expect(operationsTab().querySelector('[data-mark]')).toBeTruthy(), { timeout: 60_000 });
    expect(operationsTab().querySelector('[data-mark]')!.getAttribute('data-mark')).toBe('warning');
    expect(operationsTab().textContent).toContain('(warnings)');
    cleanup();

    plans.tamper = p => ({ ...(p as PlanResult), warnings: [], timeline: [], hold: [] });
    usePlanLayout.getState().setTab('operations');
    await open(stepUrl, 'kinderregal-eiche.step', b => b);
    await opList();
    expect(operationsTab().querySelector('[data-mark]')).toBeNull();
  }, 150_000);
});

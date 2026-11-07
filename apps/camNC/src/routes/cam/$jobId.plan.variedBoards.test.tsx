import { boardRequest, instancesOf, nestBoard, reconcileBoards, settleInputOf, suggestFixtures, withLayout } from '@/cam/boards';
import { camWorker, modelKey } from '@/cam/camQueries';
import { createJob, getModelBytes, saveJob } from '@/cam/jobDb';
import { usePlanLayout } from '@/cam/plan/planLayoutStore';
import { fixtureFree } from '@wbcnc/cam/settle';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import * as Comlink from 'comlink';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import frameUrl from '../../../../../packages/cam/test/fixtures/varied-boards/frame-01.step?url';
import gearUrl from '../../../../../packages/cam/test/fixtures/varied-boards/gear-02.step?url';
import ringsUrl from '../../../../../packages/cam/test/fixtures/varied-boards/round-02.step?url';
import trayUrl from '../../../../../packages/cam/test/fixtures/varied-boards/tray-02.step?url';
import { Route } from './$jobId.plan';

const params = vi.hoisted(() => ({ jobId: '' }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/store/store', () => ({
  useStore: Object.assign((pick: (s: object) => unknown) => pick({ machinePrefs: {} }), {
    getState: () => ({ updateToolpath: vi.fn(), setStockHeight: vi.fn(), setToolDiameter: vi.fn() }),
  }),
  selectMachineBounds: () => ({}),
}));
vi.mock('@/visualize/depthViewStore', () => ({
  useDepthView: { getState: () => ({ setZeroAt: vi.fn(), setToolShape: vi.fn() }) },
}));

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(() => {
  cleanup();
  usePlanLayout.setState(usePlanLayout.getInitialState(), true);
  localStorage.removeItem('camnc-plan-layout');
});

/** A board from one STEP fixture, laid out and ready for hold suggestions. */
async function laidOutBoard(id: string, url: string) {
  const bytes = await (await fetch(url)).arrayBuffer();
  const job = await createJob(new File([bytes], `${id}.step`));
  const stored = (await getModelBytes(job.id))!;
  const model = await camWorker().importModel(Comlink.transfer(stored, [stored.buffer as ArrayBuffer]), job.fileName, modelKey(job));
  const instances = instancesOf(model.parts, () => true);
  const [board] = reconcileBoards(undefined, instances, 'oak');
  return { laid: withLayout(board, nestBoard(board, instances, 3.175)), instances };
}

const HOLD_BOARDS = [
  ['frame-01', frameUrl],
  ['gear-02', gearUrl],
  ['round-02', ringsUrl],
  ['tray-02', trayUrl],
];

describe('varied STEP boards, end to end', () => {
  it.each(HOLD_BOARDS)(
    '[performance] %s gets its holds in under 300 ms',
    async (id, url) => {
      const { laid, instances } = await laidOutBoard(id, url);
      // Best of three: even the performance phase shares a CI machine, and a busy moment is not a slower algorithm.
      let ms = Infinity;
      for (let run = 0; run < 3; run++) {
        const t = performance.now();
        suggestFixtures(laid, instances, 3.175);
        ms = Math.min(ms, performance.now() - t);
      }
      console.info(`${id}: ${ms.toFixed(0)} ms`);
      expect(ms).toBeLessThan(300);
    },
    120_000
  );

  it.each(HOLD_BOARDS)(
    '%s gets holds clear of every cut at the app’s real clearances',
    async (id, url) => {
      const { laid, instances } = await laidOutBoard(id, url);
      const next = suggestFixtures(laid, instances, 3.175);
      const nest = nestBoard(next, instances, 3.175);
      const { input, spots } = settleInputOf(next, nest, instances, 3.175);
      for (const f of next.fixtures ?? []) expect(fixtureFree(input, spots, f)).toBe(true);
    },
    120_000
  );

  it.each([
    // Knobs take tabs on their gentle curves. A gear's teeth are all corners: the job is blocked until the board changes.
    ['frame-01', frameUrl, 11, true],
    ['gear-02', gearUrl, 4, false],
    ['round-02', ringsUrl, 12, true],
    ['tray-02', trayUrl, 60, true],
  ])(
    '%s goes from a new job to a laid out board and a plan',
    async (id, url, parts, held) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      const job = await createJob(new File([bytes], `${id}.step`));
      const stored = (await getModelBytes(job.id))!;
      const model = await camWorker().importModel(Comlink.transfer(stored, [stored.buffer as ArrayBuffer]), job.fileName, modelKey(job));
      const instances = instancesOf(model.parts, () => true);
      expect(instances).toHaveLength(parts);

      const [board, ...others] = reconcileBoards(undefined, instances, 'oak');
      expect(others).toEqual([]);
      const nest = nestBoard(board, instances, 3.175);
      expect(nest.unplaced).toEqual([]);
      expect(nest.placements).toHaveLength(parts);

      const plan = await camWorker().generateBoard(modelKey(job), boardRequest(board, nest, instances), {});
      expect(plan.safety).toEqual([]);
      expect(plan.programs.length).toBeGreaterThan(0);

      await saveJob({ ...job, boards: [withLayout(board, nest)] });
      params.jobId = job.id;
      usePlanLayout.getState().setOpsView('table');
      render(
        <QueryClientProvider client={new QueryClient()}>
          <PlanStep />
        </QueryClientProvider>
      );
      const ops = await screen.findByRole('table', { name: 'Operations for board A' }, { timeout: 90_000 });
      expect(within(ops).getAllByRole('row').length).toBeGreaterThan(1);
      if (held) {
        expect(screen.getByText(/Safety checks passed/)).toBeTruthy();
      } else {
        expect(screen.getAllByText(/would come loose when its outline is cut through/).length).toBeGreaterThan(0);
        expect(screen.queryByText(/Safety checks passed/)).toBeNull();
        expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', true);
      }
    },
    120_000
  );
});

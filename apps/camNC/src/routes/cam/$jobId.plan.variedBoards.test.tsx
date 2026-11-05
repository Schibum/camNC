import { boardRequest, instancesOf, nestBoard, reconcileBoards, withLayout } from '@/cam/boards';
import { camWorker, modelKey } from '@/cam/camQueries';
import { createJob, getModelBytes, saveJob } from '@/cam/jobDb';
import { usePlanLayout } from '@/cam/plan/planLayoutStore';
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

describe('varied STEP boards, end to end', () => {
  it.each([
    // Knobs and gears have no straight runs for tabs: the job is blocked until the board changes.
    ['frame-01', frameUrl, 11, false],
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

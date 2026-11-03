import { useStore } from '@/store/store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Comlink from 'comlink';
import { afterEach, describe, expect, it } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { instancesOf, reconcileBoards } from '../boards';
import { camKeys, camWorker, modelKey } from '../camQueries';
import { createJob, saveJob, type CamJobV1 } from '../jobDb';
import { useCamMachine } from './camMachine';
import { CamQueueCard } from './CamQueueCard';

afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  localStorage.removeItem('camnc-cam-machine');
  useStore.setState(s => {
    s.toolpath = null;
    s.toolpathName = null;
  });
});

/** A real job taken to the machine: the worker plans it, the card works on what comes back. */
async function takeJob() {
  const bytes = await (await fetch(stepUrl)).arrayBuffer();
  const created = await createJob(new File([bytes], 'kinderregal-eiche.step'));
  const copy = new Uint8Array(bytes.slice(0));
  const model = await camWorker().importModel(Comlink.transfer(copy, [copy.buffer]), created.fileName, modelKey(created));
  const instances = instancesOf(model.parts, () => true);
  const boards = reconcileBoards(undefined, instances, 'oak');
  const job = await saveJob({ ...created, boards });
  const client = new QueryClient();
  useCamMachine.getState().start(job.id);
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <CamQueueCard />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { job, client, boards };
}

const card = () => within(screen.getByRole('region', { name: 'CAM job' }));
const entry = (name: RegExp) =>
  within(card().getByRole('list', { name: 'Board queue' })).findByRole('button', { name }, { timeout: 60_000 });
const loadButton = () => card().getByRole('button', { name: 'Load program' });

describe('the machine queue with a real plan', () => {
  it('load; turn the board: checked as turned, loaded again; make a board fail a check on Boards: blocked and unloaded', async () => {
    const { job, client, boards } = await takeJob();
    fireEvent.click(await entry(/Board A/));
    await waitFor(() => expect(loadButton()).toHaveProperty('disabled', false), { timeout: 60_000 });
    const straight = useStore.getState().toolpath?.gcode;
    expect(straight).toBeTruthy();

    // Turned, the plan fails no check of its own: the rectangle turned with it. It's loaded again by itself.
    fireEvent.click(card().getByRole('button', { name: 'Turn 0.5° counterclockwise' }));
    expect(useCamMachine.getState().rotation[boards.find(b => b.name === 'A')!.id]).toBe(0.5);
    await waitFor(
      () => {
        expect(useStore.getState().toolpath?.gcode).toBeTruthy();
        expect(useStore.getState().toolpath?.gcode).not.toBe(straight);
      },
      { timeout: 60_000 }
    );
    expect(card().queryByRole('alert')).toBeNull();
    expect(useCamMachine.getState().overlay?.rotationDeg).toBe(0.5);

    // Back on Boards: a gap too narrow for the bit.
    const moved: CamJobV1 = { ...job, boards: boards.map(b => (b.name === 'A' ? { ...b, gap: 1 } : b)) };
    client.setQueryData(camKeys.job(job.id), moved);
    await waitFor(() => expect(card().getByRole('alert').textContent).toMatch(/gap between parts is too narrow.*can’t be loaded/), {
      timeout: 60_000,
    });
    expect(useStore.getState().toolpath).toBeNull();
    expect(loadButton()).toHaveProperty('disabled', true);
  }, 120_000);
});

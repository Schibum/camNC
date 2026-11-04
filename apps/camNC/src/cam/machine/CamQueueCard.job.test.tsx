import { useStore } from '@/store/store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Comlink from 'comlink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { instancesOf, reconcileBoards } from '../boards';
import { camKeys, camWorker, modelKey } from '../camQueries';
import { createJob, saveJob, type CamJobV1 } from '../jobDb';
import { getJob } from '../jobDb';
import { moveHold, useBedEdit } from './bedEdit';
import { CamBedEditor } from './CamBedEditor';
import { useCamMachine } from './camMachine';
import { CamQueueCard } from './CamQueueCard';

// The top view's editor opens the CAM job's steps; no router here.
vi.mock('@tanstack/react-router', async orig => ({ ...(await orig<object>()), useNavigate: () => () => Promise.resolve() }));

afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  localStorage.removeItem('camnc-cam-machine');
  useStore.setState(s => {
    s.toolpath = null;
    s.toolpathName = null;
  });
  useBedEdit.setState({ mode: 'move' });
});

/** A real job taken to the machine: the worker plans it, the card works on what comes back. */
async function takeJob(edit: (boards: CamJobV1['boards'] & object) => CamJobV1['boards'] = b => b) {
  const bytes = await (await fetch(stepUrl)).arrayBuffer();
  const created = await createJob(new File([bytes], 'kinderregal-eiche.step'));
  const copy = new Uint8Array(bytes.slice(0));
  const model = await camWorker().importModel(Comlink.transfer(copy, [copy.buffer]), created.fileName, modelKey(created));
  const instances = instancesOf(model.parts, () => true);
  const boards = reconcileBoards(undefined, instances, 'oak');
  const job = await saveJob({ ...created, boards: edit(boards) });
  const client = new QueryClient();
  useCamMachine.getState().start(job.id);
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <CamQueueCard />
        <CamBedEditor />
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
    useCamMachine.getState().setRotation(boards.find(b => b.name === 'A')!.id, 0.1);
    expect(useCamMachine.getState().rotation[boards.find(b => b.name === 'A')!.id]).toBe(0.1);
    await waitFor(
      () => {
        expect(useStore.getState().toolpath?.gcode).toBeTruthy();
        expect(useStore.getState().toolpath?.gcode).not.toBe(straight);
      },
      { timeout: 60_000 }
    );
    expect(card().queryByRole('alert')).toBeNull();
    expect(useCamMachine.getState().overlay?.rotationDeg).toBe(0.1);

    // Back on Boards: a gap too narrow for the bit.
    const moved: CamJobV1 = { ...job, boards: boards.map(b => (b.name === 'A' ? { ...b, gap: 1 } : b)) };
    client.setQueryData(camKeys.job(job.id), moved);
    await waitFor(() => expect(card().getByRole('alert').textContent).toMatch(/gap between parts is too narrow.*can’t be loaded/), {
      timeout: 60_000,
    });
    expect(useStore.getState().toolpath).toBeNull();
    expect(loadButton()).toHaveProperty('disabled', true);
  }, 120_000);

  it('a hold moved in the top view: saved with the job, planned again, still loadable; Undo brings it back', async () => {
    // Board A was placed on the bed before: its program goes there again.
    const { job } = await takeJob(boards => boards.map(b => (b.name === 'A' ? { ...b, bed: { a: { x: 212, y: 98 } } } : b)));
    fireEvent.click(await entry(/Board A/));
    await waitFor(() => expect(useCamMachine.getState().overlay?.holds?.length).toBeGreaterThan(0), { timeout: 60_000 });
    const offset = useStore.getState().toolpathOffset;
    expect([offset.x, offset.y]).toEqual([212, 98]);
    expect(card().getByText(/on the blue marks/)).toBeTruthy();
    const before = useStore.getState().toolpath?.gcode;
    const o = useCamMachine.getState().overlay!;
    const h = o.holds![0];
    // Along its edge, a little way: still in the frame of stock around the parts.
    const to = { x: h.x + (h.x < o.holdsOn!.w / 2 ? 10 : -10), y: h.y };
    useBedEdit.getState().apply!(moveHold(o.holds!, 0, to, o.holdsOn!, o.boardId!));
    // Fitted to its parts until now: at the machine it's a real sheet, it keeps its size and layout.
    await waitFor(
      async () => {
        const saved = (await getJob(job.id))?.boards?.find(b => b.name === 'A');
        expect(saved?.holdPoints?.[0]?.x).toBeCloseTo(to.x, 0);
        expect(saved?.size).toEqual({ fit: false, w: o.holdsOn!.w, h: o.holdsOn!.h });
      },
      { timeout: 10_000 }
    );
    await waitFor(
      () => {
        expect(useCamMachine.getState().overlay?.holds?.[0].x).toBeCloseTo(to.x, 0);
        // Planned again with it: the parts stay put, still clear of it, and its program is loaded.
        expect(card().queryByRole('alert')).toBeNull();
        expect(useStore.getState().toolpath?.gcode).toBe(before);
      },
      { timeout: 60_000 }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(
      async () => {
        const saved = (await getJob(job.id))?.boards?.find(b => b.name === 'A');
        expect([saved?.holdPoints, saved?.size, saved?.positions]).toEqual([undefined, { fit: true }, undefined]);
      },
      { timeout: 10_000 }
    );
  }, 120_000);
});

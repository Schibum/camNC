import { addRectangle, createCadPart, createPlateDocument, migrateDimensionPlacements, updateDimension } from '@wbcnc/cad';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { getCncApi } from '@/lib/fluidnc/machine';
import { moveToolpathToMachineZero, uploadAndRun, zeroAndRun } from '@/lib/machine/jobs';
import { applyRecord, dismissInterruptedJob, interruptedJob } from '@/lib/machine/jobRecovery';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from '../cadDesign';
import { instancesOf, nestBoard, reconcileBoards, withLayout } from '../boards';
import { camKeys } from '../camQueries';
import type { ModelImport, PlanResult } from '../camTypes';
import { createDesignJob, getJob, saveJob } from '../jobDb';
import { nativeCadModel } from '../nativeCadModel';
import { isManufacturingLocked, machineQueue, pinManufacturingRun, useCamMachine } from './camMachine';
import { recordNativeRun } from './nativeRunHistory';
import { CamQueueCard } from './CamQueueCard';
import { CamMachineJobNav } from './CamMachineJobNav';
import { useMachineQueue } from './useMachineQueue';

const hooks = vi.hoisted(() => ({
  model: { data: undefined as ModelImport | undefined, isError: false, error: null as Error | null },
  plans: [] as { data: PlanResult | undefined; isPlaceholderData: boolean; isError: boolean; error?: Error }[],
}));
vi.mock('../camQueries', async original => ({
  ...(await original<typeof import('../camQueries')>()),
  useCamModel: () => hooks.model,
  useBoardPlans: () => hooks.plans,
}));
vi.mock('@tanstack/react-router', async original => ({
  ...(await original<object>()),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

let latest!: ReturnType<typeof useMachineQueue>;
function Probe() {
  latest = useMachineQueue();
  return null;
}

afterEach(() => {
  cleanup();
  interruptedJob.value = null;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  const api = getCncApi();
  api.jobStartedAt.value = null;
  useStore.setState(state => {
    state.toolpath = null;
    state.toolpathName = null;
  });
});

async function fixture(singleBoard = false) {
  const empty = await createDesignJob('Native queue lifecycle');
  const document = { ...createPlateDocument({ width: 100, height: 80, thickness: 18 }), id: empty.design!.draft.id };
  const second = createCadPart('Second board part', 12);
  second.sketch = addRectangle(second.sketch, { x: 0, y: 0, width: 60, height: 40, dimensioned: true });
  if (!singleBoard) document.parts.push(second);
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const { model } = await nativeCadModel(accepted.design!.accepted!);
  const instances = instancesOf(model.parts, () => true);
  const boards = reconcileBoards(undefined, instances, 'oak').map(board => {
    const held = { ...board, taped: true, retention: 'none' as const };
    return withLayout(held, nestBoard(held, instances, 3.175, { preserveLayout: true }));
  });
  const job = await saveJob({ ...accepted, boards });
  hooks.model = { data: model, isError: false, error: null };
  hooks.plans = boards.map((board, index) => ({
    isPlaceholderData: false,
    isError: false,
    data: {
      sourceKey: boardGeometryKey(
        job,
        board.items.map(id => id.split('#')[0])
      ),
      gcode: `(native board ${index})\nG21 G90\nG0 Z25\nG0 X1 Y1\nG1 X10 F300`,
      programs: [{ tool: 1, diameter: 3.175, gcode: `(native board ${index})\nG21 G90\nG0 Z25\nG0 X1 Y1\nG1 X10 F300`, timeMin: 1 }],
      bits: [3.175],
      size: [board.layout!.w, board.layout!.h, board.thickness + 0.3],
      ops: [{}],
      safety: [],
      warnings: [],
      path: [],
      timeMin: 1,
    } as unknown as PlanResult,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(camKeys.job(job.id), job);
  useCamMachine.getState().start(job.id);
  const view = (children: ReactNode = <CamQueueCard />) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Probe />
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { job, document, boards, instances, client, model, view };
}

it('keeps a protected program current when accepted annotations only receive a storage representation upgrade', async () => {
  const f = await fixture();
  const legacy = structuredClone(f.job.design!.accepted!);
  const width = legacy.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
  if (!('value' in width)) throw new Error('Expected the plate width dimension.');
  delete width.labelPlacement;
  width.labelPosition = { x: 25, y: -20 };
  const stored = await saveJob({ ...f.job, design: { ...f.job.design!, draft: legacy, accepted: structuredClone(legacy) } });
  f.client.setQueryData(camKeys.job(stored.id), stored);
  const { rerender } = render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const original = useStore.getState().toolpath!.gcode;
  const snapshot = pinManufacturingRun(original)!;
  useCamMachine.setState({ preparingRun: false, runReview: 'finished' });
  const canonical = migrateDimensionPlacements(legacy);
  const accepted = await acceptDesign(await saveDesignDraft(stored, canonical), canonical);
  f.client.setQueryData(camKeys.job(stored.id), accepted);
  rerender(f.view());
  await waitFor(() => {
    expect(latest.snapshot?.runId).toBe(snapshot.runId);
    expect(latest.designChanged).toBe(false);
    expect(useStore.getState().toolpath?.gcode).toBe(original);
    expect(screen.getByRole('status').textContent).toContain('Run review: finished');
    expect(screen.queryByText(/Current design is revision/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use current design with a new setup' })).toBeNull();
  });
}, 30_000);

it('M1 records a completed native run after CAD acceptance without erasing boards while its model reloads', async () => {
  const f = await fixture();
  const first = render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const frozen = pinManufacturingRun(useStore.getState().toolpath!.gcode)!;
  useCamMachine.setState({ preparingRun: false });
  fireEvent.click(screen.getByRole('button', { name: 'Done, next' }));
  expect(useCamMachine.getState().done).toContain(frozen.doneId);
  first.unmount();
  const width = f.document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
  const changed = updateDimension(f.document, width.id, 110);
  const accepted = await acceptDesign(await saveDesignDraft(f.job, changed), changed);
  f.client.setQueryData(camKeys.job(f.job.id), accepted);
  hooks.model = { data: undefined, isError: false, error: null };
  render(f.view(<CamMachineJobNav />));
  await waitFor(async () => {
    const saved = (await getJob(f.job.id))!;
    expect(saved.boards?.map(b => b.id)).toEqual(f.boards.map(b => b.id));
    expect(saved.boards?.find(b => b.id === frozen.queue[0].board.board.id)?.cut?.keys).toContain(frozen.doneId);
    expect(saved.design!.acceptedRevision).toBe(accepted.design!.acceptedRevision);
  });
}, 30_000);

it.each(['pending', 'failed'] as const)(
  'M1 preserves durable boards for setup writes when the model is %s',
  async state => {
    const f = await fixture();
    hooks.model = { data: undefined, isError: state === 'failed', error: state === 'failed' ? new Error('Native import failed') : null };
    render(f.view(null));
    latest.updateBoard(f.boards[0].id, { taped: false });
    latest.setStockThickness(f.boards[1].id, 13.2);
    await waitFor(async () => {
      const saved = (await getJob(f.job.id))!;
      expect(saved.boards?.map(b => b.id)).toEqual(f.boards.map(b => b.id));
      expect(saved.boards?.[0].taped).toBe(false);
      expect(saved.boards?.[1].measuredThickness).toBe(13.2);
    });
  },
  30_000
);

it('M2 uses fresh setup and program after the pinned native run is idle, even when the design revision did not change', async () => {
  const f = await fixture();
  const { rerender } = render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const original = useStore.getState().toolpath!.gcode;
  pinManufacturingRun(original);
  useCamMachine.setState({ preparingRun: false });
  const updated = await saveJob(
    { ...f.job, boards: f.boards.map((b, i) => (i ? b : { ...b, measuredThickness: 19.2, bed: { a: { x: 40, y: 50, deg: 12 } } })) },
    f.job
  );
  f.client.setQueryData(camKeys.job(f.job.id), updated);
  const old = hooks.plans[0].data!;
  hooks.plans = [
    {
      ...hooks.plans[0],
      data: {
        ...old,
        size: [old.size[0], old.size[1], 19.2],
        gcode: '(fresh setup)\n' + old.gcode,
        programs: [{ ...old.programs[0], gcode: '(fresh setup)\n' + old.programs[0].gcode }],
      },
    },
    hooks.plans[1],
  ];
  rerender(f.view());
  await waitFor(() => {
    expect(latest.current?.board.board.measuredThickness).toBe(19.2);
    expect(useStore.getState().toolpath?.gcode).not.toBe(original);
    expect(useStore.getState().toolpath?.gcode).toContain('(fresh setup)');
    expect(latest.current?.board.request.rotationDeg).toBe(12);
    expect(useCamMachine.getState().overlay?.rotationDeg).toBe(12);
    expect(useStore.getState().stockHeight).toBe(19.2);
  });
}, 30_000);

it.each(['hold', 'part'] as const)(
  'M2 unloads an idle setup for a changed %s and preserves fresh blocking checks',
  async edit => {
    const f = await fixture();
    const { rerender } = render(f.view());
    fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
    pinManufacturingRun(useStore.getState().toolpath!.gcode);
    useCamMachine.setState({ preparingRun: false });
    const old = hooks.plans[0].data!;
    const first = f.boards[0];
    const board =
      edit === 'hold'
        ? { ...first, fixtures: [{ kind: 'screw' as const, x: 20, y: 20 }] }
        : {
            ...first,
            size: { fit: false as const, w: first.layout!.w, h: first.layout!.h },
            layout: { ...first.layout!, at: { ...first.layout!.at, [first.items[0]]: { x: 10_000, y: 0, rotated: false } } },
          };
    const changed = await saveJob({ ...f.job, boards: [board, f.boards[1]] }, f.job);
    f.client.setQueryData(camKeys.job(f.job.id), changed);
    hooks.plans[0] = { ...hooks.plans[0], isPlaceholderData: true };
    rerender(f.view());
    await waitFor(() => {
      expect(latest.stale.has(first.id)).toBe(true);
      expect(useStore.getState().toolpath).toBeNull();
      expect(useCamMachine.getState().loadedSnapshot).toBeNull();
    });
    hooks.plans[0] = {
      data: { ...old, ...(edit === 'hold' && { holdClash: [{ x: 20, y: 20 }] }) },
      isPlaceholderData: false,
      isError: false,
    };
    rerender(f.view());
    await waitFor(() => {
      expect(latest.current?.blocked).toMatch(edit === 'hold' ? /bit’s way/ : /fit/);
      expect(screen.getByRole('button', { name: 'Load program' })).toHaveProperty('disabled', true);
      expect(useStore.getState().toolpath).toBeNull();
    });
  },
  30_000
);

it('M4 snapshots only a ready executable active entry and leaves unrelated pending entries outside the candidate', async () => {
  const f = await fixture();
  hooks.plans[1] = { data: undefined, isError: false, isPlaceholderData: false };
  render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const candidate = useCamMachine.getState().loadedSnapshot!;
  expect(candidate.queue).toHaveLength(1);
  expect(candidate.queue[0].key).toBe(candidate.active);
  expect(candidate.queue[0].kind).toBe('bit');
}, 30_000);

it('M4 keeps another board live and stale-guarded while the current native entry is protected', async () => {
  const f = await fixture();
  const secondPlan = hooks.plans[1];
  hooks.plans[1] = { data: undefined, isError: false, isPlaceholderData: false };
  const { rerender } = render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const gcode = useStore.getState().toolpath!.gcode;
  hooks.plans[1] = { ...secondPlan, isPlaceholderData: true };
  rerender(f.view());
  pinManufacturingRun(gcode);
  rerender(f.view());
  await waitFor(() => {
    expect(latest.queue.find(e => e.board.board.id === f.boards[1].id)?.plan).toEqual(secondPlan.data);
    expect(latest.stale.has(f.boards[1].id)).toBe(true);
    expect(latest.current?.key).toBe(useCamMachine.getState().runSnapshot?.active);
  });
}, 30_000);

it('M2 preserves the actual resumed tail while protected and an ordinary queue Load later restores the full program', async () => {
  const f = await fixture();
  const { rerender } = render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const full = useStore.getState().toolpath!.gcode;
  const snapshot = pinManufacturingRun(full)!;
  useCamMachine.setState({ preparingRun: false });
  const tail = '(Resume tail)\nG21 G90\nG0 Z25\nG0 X2 Y2\nG1 X5 F300';
  const record = {
    host: 'native-queue-resume',
    sdFile: 'camnc-resume.gcode',
    gcode: tail,
    toolpathName: 'Resuming native program',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18.3,
    toolDiameter: 3.175,
    wco: { x: 0, y: 0, z: 0 },
    startedAt: 1,
    homed: true,
    zZeroedAt: 1,
    camSnapshot: snapshot,
  };
  interruptedJob.value = {
    record,
    reason: 'Stopped',
    progress: { host: record.host, file: record.sdFile, percent: 40, mpos: { x: 0, y: 0, z: 0 }, wco: record.wco, at: 2 },
  };
  applyRecord(getCncApi(), record, { machineState: false });
  rerender(f.view());
  expect(latest.snapshot?.gcode).toBe(full);
  expect(useStore.getState().toolpath?.gcode).toBe(tail);
  expect(screen.getByRole('button', { name: 'Load program' })).toHaveProperty('disabled', true);
  dismissInterruptedJob();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close run review and use current setup' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Close run review and use current setup' }));
  await waitFor(() => expect(useCamMachine.getState().runReview).toBeNull());
  rerender(f.view());
  fireEvent.click(screen.getByRole('button', { name: /^Board queue:/ }));
  const entry = screen.getByRole('list', { name: 'Board queue' }).querySelector('button')!;
  fireEvent.click(entry);
  expect(useStore.getState().toolpath?.gcode).toBe(full);
}, 30_000);

it('N5 keeps a finished original run in review after newer design acceptance and Done names only its original program', async () => {
  const f = await fixture();
  const { rerender } = render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const original = useStore.getState().toolpath!.gcode;
  const snapshot = pinManufacturingRun(original)!;
  useCamMachine.setState({ preparingRun: false, runReview: 'finished' });
  const width = f.document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const changed = updateDimension(f.document, width.id, 110);
  const revised = await acceptDesign(await saveDesignDraft(f.job, changed), changed);
  f.client.setQueryData(camKeys.job(f.job.id), revised);
  const old = hooks.plans[0].data!;
  hooks.plans[0] = {
    ...hooks.plans[0],
    data: { ...old, programs: [{ ...old.programs[0], gcode: '(new accepted design)\n' + old.gcode }] },
  };
  rerender(f.view());
  expect(latest.current?.doneId).toBe(snapshot.doneId);
  expect(useStore.getState().toolpath?.gcode).toBe(original);
  expect(screen.getByRole('status').textContent).toContain('Run review: finished');
  expect(screen.getByRole('button', { name: 'Use current design with a new setup' })).toBeEnabled();
  expect(screen.getByLabelText(/Stock thickness of board/)).toBeDisabled();
  const newDoneId = machineQueue([latest.current!.board], [hooks.plans[0].data!])[0].doneId;
  expect(newDoneId).not.toBe(snapshot.doneId);
  fireEvent.click(screen.getByRole('button', { name: 'Done, next' }));
  await waitFor(() => expect(useCamMachine.getState().done).toContain(snapshot.doneId));
  expect(useCamMachine.getState().done).not.toContain(newDoneId);
  expect(useCamMachine.getState().runReview).toBeNull();
}, 30_000);

it('N5 releases a stopped run through explicit review without marking it Done or silently swapping its program', async () => {
  const f = await fixture();
  const { rerender } = render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const original = useStore.getState().toolpath!.gcode;
  const snapshot = pinManufacturingRun(original)!;
  useCamMachine.setState({ preparingRun: false, runReview: 'stopped' });
  rerender(f.view());
  expect(screen.getByRole('status').textContent).toContain('Run review: stopped');
  expect(screen.getByRole('button', { name: 'Done, next' })).toBeDisabled();
  expect(useStore.getState().toolpath?.gcode).toBe(original);
  fireEvent.click(screen.getByRole('button', { name: 'Close run review and use current setup' }));
  await waitFor(() => expect(useCamMachine.getState().runReview).toBeNull());
  expect(useCamMachine.getState().done).not.toContain(snapshot.doneId);
  expect(useCamMachine.getState().runSnapshot).toBeNull();
}, 30_000);

it('N5 Use current design really acknowledges a finished run and leaves the old physical sheet blocked for revision2', async () => {
  const f = await fixture();
  const { rerender } = render(f.view());
  fireEvent.click(await screen.findByRole('button', { name: 'Load program' }));
  const snapshot = pinManufacturingRun(useStore.getState().toolpath!.gcode)!;
  useCamMachine.setState({ preparingRun: false, runReview: 'finished' });
  await recordNativeRun(snapshot);
  await recordNativeRun(snapshot, true);
  const width = f.document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const changed = updateDimension(f.document, width.id, 110);
  const current = (await getJob(f.job.id))!;
  const revised = await acceptDesign(await saveDesignDraft(current, changed), changed);
  hooks.model = { data: (await nativeCadModel(revised.design!.accepted!)).model, isError: false, error: null };
  hooks.plans[0] = {
    ...hooks.plans[0],
    data: {
      ...hooks.plans[0].data!,
      sourceKey: boardGeometryKey(
        revised,
        revised.design!.accepted!.parts.map(p => p.id)
      ),
      programs: [{ ...hooks.plans[0].data!.programs[0], gcode: '(revision2)\nG21\nG1 X15 F300' }],
    },
  };
  f.client.setQueryData(camKeys.job(f.job.id), revised);
  rerender(f.view());
  const button = screen.getByRole('button', { name: 'Use current design with a new setup' });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() => expect(useCamMachine.getState().runSnapshot).toBeNull());
  await waitFor(() => expect(latest.queue.find(e => e.board.board.id === f.boards[0].id)?.blocked).toMatch(/earlier design/));
  expect(useStore.getState().toolpath).toBeNull();
  expect((await getJob(f.job.id))!.boards![0].cut?.keys).toContain(snapshot.doneId);
}, 30_000);

it('saves the machine-zero placement before preparation locks it and keeps it for the next program', async () => {
  const f = await fixture(true);
  const first = f.boards[0];
  const D = { x: 150, y: 220 },
    M = { x: 340, y: 420 };
  const original = await saveJob({ ...f.job, boards: f.job.boards!.map(b => (b.id === first.id ? { ...b, bed: { a: D } } : b)) });
  f.client.setQueryData(camKeys.job(f.job.id), original);
  const plan = hooks.plans[0].data!;
  plan.programs.push({ ...plan.programs[0], tool: 2, diameter: 6, gcode: '(second)\nG21 G90\nG0 X1 Y1 Z25\nG1 X20 F300' });
  plan.bits.push(6);
  useCamMachine.setState({ active: `${first.id}:bit:0` });
  render(f.view());
  await waitFor(() => expect(useStore.getState().toolpath?.gcode).toBe(plan.programs[0].gcode));
  const api = getCncApi();
  const host = `keep-placement-${f.job.id}`;
  api.host.value = host;
  api.status.value = { state: 'Idle', mpos: { ...M, z: -5 }, wco: { ...M, z: -30 }, wpos: { x: 0, y: 0, z: 25 } } as never;
  const read = vi.spyOn(api, 'getCurrentZero').mockResolvedValue({ ...M, z: -30 });
  const upload = vi.spyOn(api, 'uploadGcode').mockResolvedValue(undefined);
  const run = vi.spyOn(api, 'runFile').mockResolvedValue(undefined);
  const zero = vi.spyOn(api, 'setWorkspaceXYZero').mockResolvedValue([]);
  try {
    await waitFor(() => expect(isManufacturingLocked()).toBe(false));
    expect(await moveToolpathToMachineZero()).toBe(true);
    useCamMachine.setState({ preparingRun: true });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect((await getJob(f.job.id))!.boards!.find(b => b.id === first.id)!.bed!.a).toMatchObject(M);
    useCamMachine.setState({ preparingRun: false });
    await uploadAndRun();
    const { loadJobRecord, clearJobRecord } = await import('@/lib/machine/jobRecord');
    const firstRun = (await loadJobRecord(host))!;
    expect(firstRun.wco).toMatchObject(M);
    expect(zero).not.toHaveBeenCalled();
    useCamMachine.setState({ runReview: 'finished' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Run review: finished'));
    fireEvent.click(screen.getByRole('button', { name: 'Done, next' }));
    await waitFor(() => expect(useCamMachine.getState().active).toBe(`${first.id}:bit:1`));
    await waitFor(() => expect(useStore.getState().toolpathOffset).toMatchObject(M));
    await zeroAndRun();
    expect(zero).toHaveBeenCalledWith(M.x, M.y);
    expect((await loadJobRecord(host))!.wco).toEqual(firstRun.wco);
    expect(run).toHaveBeenCalledTimes(2);
    await clearJobRecord(host);
  } finally {
    read.mockRestore();
    upload.mockRestore();
    run.mockRestore();
    zero.mockRestore();
    useCamMachine.setState({ preparingRun: false });
  }
}, 30000);

import { afterEach, describe, expect, it } from 'vitest';
import { CncApi } from '@/lib/fluidnc/cnc-api';
import { applyRecord, dismissInterruptedJob, interruptedJob } from '@/lib/machine/jobRecovery';
import { clearJobRecord, loadJobRecord, saveJobRecord, type JobRecord } from '@/lib/machine/jobRecord';
import type { PlanResult } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import { layoutBlock } from '../boardBlock';
import { cutsToRecord, isManufacturingLocked, machineQueue, pinManufacturingRun, useCamMachine } from './camMachine';
import { captureManufacturingSnapshot, type ManufacturingSnapshot } from './manufacturingSnapshot';
import { openAtMachine } from './openAtMachine';
import { clearMachineView, loadIntoMachineView } from '../showOnMachine';
import { useStore } from '@/store/store';
import { Vector3 } from 'three';

function fixture(): ManufacturingSnapshot {
  const board = { board: { id: 'sheet', name: 'A' }, nest: {}, request: { parts: [{ id: 'instance' }] } } as JobBoard;
  const plan = {
    sourceKey: 'part:revision-1',
    programs: [{ tool: 1, diameter: 3, gcode: 'G21\nG1 X10 F300', timeMin: 1 }],
    bits: [3],
    ops: [],
    size: [100, 80, 18],
    safety: [],
    path: [],
  } as unknown as PlanResult;
  const queue = machineQueue([board], [plan]);
  return {
    jobId: 'design',
    sourceKey: 'design:cad:1',
    designRevision: 1,
    active: queue[0].key,
    doneId: queue[0].doneId,
    gcode: plan.programs[0].gcode,
    queue,
    parts: [],
    instances: [],
    nestBit: 3,
    overlay: {
      w: 100,
      h: 80,
      rotationDeg: 0,
      boardId: 'sheet',
      path: [
        [
          [0, 0, 18],
          [10, 0, 18],
        ],
      ],
    },
  };
}

afterEach(async () => {
  interruptedJob.value = null;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  await clearJobRecord('snapshot-test');
});

function interruptedSnapshot(snapshot: ManufacturingSnapshot) {
  return {
    record: {
      host: 'snapshot-test',
      sdFile: 'camnc-resume.gcode',
      gcode: '(resume tail)\nG21\nG1 X8 F300',
      toolpathName: 'Resuming plate',
      toolpathOffset: { x: 0, y: 0, z: 0 },
      stockHeight: 18,
      toolDiameter: 3,
      wco: { x: 0, y: 0, z: 0 },
      startedAt: 1,
      homed: true,
      zZeroedAt: 1,
      camSnapshot: snapshot,
    },
    progress: {
      host: 'snapshot-test',
      file: 'camnc-resume.gcode',
      percent: 40,
      at: 2,
      mpos: { x: 0, y: 0, z: 0 },
      wco: { x: 0, y: 0, z: 0 },
    },
    reason: 'Stopped',
  };
}

it('M2 guards direct setup replacement commands until the matching native recovery is dismissed', () => {
  const loaded = fixture();
  interruptedJob.value = interruptedSnapshot(loaded);
  useStore.getState().updateToolpath(interruptedJob.value.record.gcode, 'Resuming plate');
  useCamMachine.setState({ jobId: loaded.jobId, active: loaded.active, loadedSnapshot: loaded, runSnapshot: loaded });
  const tail = useStore.getState().toolpath!.gcode;
  openAtMachine('another-design');
  useCamMachine.getState().start('another-design');
  useCamMachine.getState().leave();
  useCamMachine.getState().releaseSnapshot();
  clearMachineView();
  loadIntoMachineView({ gcode: 'G21\nG1 X75 F300', size: [75, 80, 18], bits: [3] }, 'Changed');
  expect(useCamMachine.getState().jobId).toBe(loaded.jobId);
  expect(useCamMachine.getState().active).toBe(loaded.active);
  expect(useCamMachine.getState().runSnapshot).toEqual(loaded);
  expect(useStore.getState().toolpath?.gcode).toBe(tail);
  expect(isManufacturingLocked()).toBe(true);
  dismissInterruptedJob();
  expect(isManufacturingLocked()).toBe(false);
  loadIntoMachineView({ gcode: loaded.gcode, size: [100, 80, 18], bits: [3] }, 'Full program');
  expect(useStore.getState().toolpath?.gcode).toBe(loaded.gcode);
});

it('M2 does not lock an unrelated interrupted source or a different executable program', () => {
  const loaded = fixture();
  useCamMachine.setState({ jobId: loaded.jobId, active: loaded.active, runSnapshot: loaded });
  interruptedJob.value = interruptedSnapshot({ ...loaded, sourceKey: 'different-source' });
  expect(isManufacturingLocked()).toBe(false);
  interruptedJob.value = interruptedSnapshot({ ...loaded, gcode: 'another program', doneId: 'another-program-hash' });
  expect(isManufacturingLocked()).toBe(false);
  useCamMachine.getState().start('another-design');
  expect(useCamMachine.getState().jobId).toBe('another-design');
});

describe('manufacturing revisions', () => {
  it('pins programs, placement and display geometry independently of the editable project', () => {
    const live = fixture();
    const frozen = captureManufacturingSnapshot(live);
    live.queue[0].board.board.name = 'Edited board';
    live.queue[0].board.request.parts[0].id = 'replacement';
    live.overlay!.path![0][1][0] = 75;
    expect(frozen.queue[0].board.board.name).toBe('A');
    expect(frozen.queue[0].board.request.parts[0].id).toBe('instance');
    expect(frozen.overlay!.path![0][1][0]).toBe(10);
  });

  it('pins only the setup whose actual program is being uploaded', () => {
    const loaded = fixture();
    useCamMachine.setState({ jobId: loaded.jobId, active: loaded.active, loadedSnapshot: loaded });
    expect(pinManufacturingRun('another program')).toBeUndefined();
    expect(useCamMachine.getState().runSnapshot).toBeNull();
    const run = pinManufacturingRun(loaded.gcode)!;
    loaded.sourceKey = 'design:cad:2';
    loaded.queue[0].board.board.name = 'New design';
    expect(run.sourceKey).toBe('design:cad:1');
    expect(useCamMachine.getState().runSnapshot?.queue[0].board.board.name).toBe('A');
    expect(useCamMachine.getState().preparingRun).toBe(true);
  });

  it('captures the camera placement actually in use after the program was loaded', () => {
    const loaded = fixture();
    loaded.queue[0].board.board.bed = { a: { x: 1, y: 2, deg: 0 } };
    useCamMachine.setState({
      jobId: loaded.jobId,
      active: loaded.active,
      loadedSnapshot: loaded,
      overlay: { ...loaded.overlay!, rotationDeg: 12 },
    });
    useStore.getState().setToolpathOffset(new Vector3(212, 98, 0));
    const run = pinManufacturingRun(loaded.gcode)!;
    expect(run.queue[0].board.board.bed?.a).toEqual({ x: 212, y: 98, deg: 12 });
    expect(run.overlay?.rotationDeg).toBe(12);
    expect(loaded.queue[0].board.board.bed?.a?.x).toBe(1);
  });

  it('records completed programs against their original geometry and blocks a changed physical sheet', () => {
    const snapshot = fixture();
    const cuts = cutsToRecord(snapshot.queue, [snapshot.doneId], 100)!;
    expect(cuts.sheet.sourceKey).toBe('part:revision-1');
    const board = { ...snapshot.queue[0].board, board: { ...snapshot.queue[0].board.board, cut: cuts.sheet } };
    expect(layoutBlock(board, { bit: 3, missing: [], sourceKey: 'part:revision-2' })).toMatch(/earlier design/);
  });

  it('cannot replace or leave a setup while its upload is pending, including direct navigation actions', () => {
    const loaded = fixture();
    useStore.getState().updateToolpath(loaded.gcode, 'Original');
    useCamMachine.setState({ jobId: loaded.jobId, active: loaded.active, loadedSnapshot: loaded });
    pinManufacturingRun(loaded.gcode);
    expect(openAtMachine('another-design')).toBe('/visualize/2DView');
    useCamMachine.getState().start('another-design');
    useCamMachine.getState().leave();
    useCamMachine.getState().releaseSnapshot();
    clearMachineView();
    loadIntoMachineView({ gcode: 'G21\nG1 X75 F300', size: [75, 80, 18], bits: [3] }, 'Changed');
    expect(useCamMachine.getState().jobId).toBe(loaded.jobId);
    expect(useCamMachine.getState().runSnapshot?.sourceKey).toBe(loaded.sourceKey);
    expect(useStore.getState().toolpath?.gcode).toBe(loaded.gcode);
  });

  it('persists and restores the original queue and overlay after editing or a reload', async () => {
    const snapshot = fixture();
    const record: JobRecord = {
      host: 'snapshot-test',
      sdFile: 'camnc.gcode',
      gcode: snapshot.gcode,
      toolpathName: 'Plate',
      toolpathOffset: { x: 12, y: 34, z: 0 },
      stockHeight: 18,
      toolDiameter: 3,
      wco: { x: 12, y: 34, z: 0 },
      startedAt: 1,
      homed: true,
      zZeroedAt: 1,
      camSnapshot: snapshot,
    };
    record.gcode = '(Resume from line 5)\nG21\nG1 X8 F300';
    await saveJobRecord(record);
    snapshot.overlay!.w = 75;
    useCamMachine.setState({ jobId: 'another-project', runSnapshot: null });
    const saved = (await loadJobRecord(record.host))!;
    applyRecord(new CncApi(), saved, { machineState: false });
    expect(useCamMachine.getState().jobId).toBe('design');
    expect(useCamMachine.getState().runSnapshot?.sourceKey).toBe('design:cad:1');
    expect(useCamMachine.getState().runSnapshot?.gcode).toBe(snapshot.gcode);
    expect(useStore.getState().toolpath?.gcode).toBe(record.gcode);
    expect(useCamMachine.getState().overlay?.w).toBe(100);
  });
});

it('N4 cannot switch active entry through Plan Show and thereby unlock a resumable native setup', () => {
  const loaded = fixture();
  interruptedJob.value = interruptedSnapshot(loaded);
  useStore.getState().updateToolpath(interruptedJob.value.record.gcode, 'Resuming plate');
  useCamMachine.setState({
    jobId: loaded.jobId,
    active: loaded.active,
    loadedSnapshot: loaded,
    runSnapshot: loaded,
    overlay: loaded.overlay,
  });
  const tail = useStore.getState().toolpath!.gcode;
  useCamMachine.getState().start('another-design');
  useCamMachine.getState().setActive('different-board:bit:0');
  loadIntoMachineView({ gcode: 'G21\nG1 X75 F300', size: [75, 80, 18], bits: [3] }, 'Plan Show');
  useCamMachine.getState().setOverlay({ w: 75, h: 80, rotationDeg: 20 });
  expect(useCamMachine.getState().active).toBe(loaded.active);
  expect(isManufacturingLocked()).toBe(true);
  expect(useCamMachine.getState().overlay).toEqual(loaded.overlay);
  expect(useStore.getState().toolpath?.gcode).toBe(tail);
});

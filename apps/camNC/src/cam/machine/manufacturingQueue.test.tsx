import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModelImport, PlanResult } from '../camTypes';
import type { CamJobV1 } from '../jobDb';
import type { JobBoard } from '../useJobBoards';
import { machineQueue, useCamMachine } from './camMachine';
import { captureManufacturingSnapshot } from './manufacturingSnapshot';
import { useMachineQueue } from './useMachineQueue';

const data = vi.hoisted(() => ({
  job: null as CamJobV1 | null,
  model: undefined as ModelImport | undefined,
  boards: [] as JobBoard[],
  plans: [] as PlanResult[],
  error: undefined as Error | undefined,
}));
vi.mock('../camQueries', () => ({
  useCamJob: () => ({ data: data.job }),
  useCamModel: () => ({ data: data.model, error: data.error, isError: !!data.error }),
  useBoardPlans: () => data.plans.map(plan => ({ data: plan, isPlaceholderData: false })),
  useSaveCamJob: () => ({ mutate: vi.fn() }),
}));
vi.mock('../useJobBoards', () => ({ useJobBoards: () => ({ boards: data.boards, instances: [] }), missingParts: () => [] }));

function View() {
  const { current, designChanged, modelError, parts } = useMachineQueue();
  return (
    <>
      <p>{current?.board.board.name}</p>
      <p>{current?.plan?.programs[0].gcode}</p>
      <p>{designChanged ? 'New design available' : 'Current design'}</p>
      <p>{modelError}</p>
      <p>{parts?.[0]?.name}</p>
    </>
  );
}

afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

it('keeps the protected manufacturing entry and geometry when a newer design is accepted or fails to load', () => {
  const board = { board: { id: 'sheet', name: 'Original sheet' }, nest: {}, request: { parts: [{ id: 'part#0' }] } } as unknown as JobBoard;
  const plan = { bits: [3], programs: [{ gcode: 'Original program', diameter: 3, tool: 1, timeMin: 1 }] } as PlanResult;
  const queue = machineQueue([board], [plan]);
  data.job = { id: 'project', fileName: 'Plate', design: { acceptedRevision: 1 } } as CamJobV1;
  data.boards = [];
  data.plans = [];
  data.model = undefined;
  const runSnapshot = captureManufacturingSnapshot({
    jobId: 'project',
    sourceKey: 'project:cad:1',
    designRevision: 1,
    active: queue[0].key,
    doneId: queue[0].doneId,
    gcode: 'Original program',
    queue,
    parts: [{ id: 'part', name: 'Original geometry' }] as ModelImport['parts'],
    instances: [],
    nestBit: 3,
    overlay: { w: 120, h: 80, rotationDeg: 0 },
  });
  useCamMachine.setState({ jobId: 'project', active: queue[0].key, runSnapshot, preparingRun: true });
  const { rerender } = render(<View />);
  expect(screen.getByText('Original program')).toBeTruthy();
  data.job = { ...data.job, design: { ...data.job.design!, acceptedRevision: 2 } };
  data.error = new Error('New geometry could not load');
  rerender(<View />);
  expect(screen.getByText('Original sheet')).toBeTruthy();
  expect(screen.getByText('Original program')).toBeTruthy();
  expect(screen.getByText('Original geometry')).toBeTruthy();
  expect(screen.getByText('New design available')).toBeTruthy();
  expect(screen.queryByText('New geometry could not load')).toBeNull();
  data.error = undefined;
});

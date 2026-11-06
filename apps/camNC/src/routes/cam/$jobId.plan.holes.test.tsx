import { instancesOf, reconcileBoards } from '@/cam/boards';
import { camWorker, modelKey } from '@/cam/camQueries';
import { createJob, getJob, saveJob } from '@/cam/jobDb';
import * as Comlink from 'comlink';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExtrudeGeometry, Path, Shape } from 'three';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/cam/plan3d/PlanView3D', () => ({ PlanView3D: () => null }));

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

/** A plate with a ⌀40 through hole, as a binary STL. */
function plateStl() {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(150, 0);
  shape.lineTo(150, 80);
  shape.lineTo(0, 80);
  shape.closePath();
  const hole = new Path();
  hole.absarc(75, 40, 20, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const position = new ExtrudeGeometry(shape, { depth: 18, bevelEnabled: false, curveSegments: 48 }).attributes.position.array;
  const count = position.length / 9;
  const bytes = new ArrayBuffer(84 + 50 * count);
  const view = new DataView(bytes);
  view.setUint32(80, count, true);
  for (let i = 0; i < count; i++) {
    const at = 84 + 50 * i;
    const [a, b, c] = [0, 3, 6].map(k => [position[i * 9 + k], position[i * 9 + k + 1], position[i * 9 + k + 2]]);
    const [u, v] = [b.map((q, j) => q - a[j]), c.map((q, j) => q - a[j])];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n) || 1;
    [...n.map(q => q / length), ...a, ...b, ...c].forEach((q, j) => view.setFloat32(at + j * 4, q, true));
  }
  return bytes;
}

afterEach(cleanup);

describe('Plan step: a hole whose middle comes loose', () => {
  it('says so, and clears it from there', { timeout: 120_000 }, async () => {
    const job = await createJob(new File([plateStl()], 'plate.stl'), { name: 'Plate' });
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );
    expect(await screen.findByText(/the 34 mm piece in a through hole comes loose/, {}, { timeout: 60_000 })).toBeTruthy();
    expect(screen.queryByText(/Middle of a through hole/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Clear it, about \+\d/ }));
    await screen.findByText(/Middle of a through hole/, {}, { timeout: 60_000 });
    expect(screen.queryByText(/comes loose on the last pass/)).toBeNull();
    await waitFor(async () => expect((await getJob(job.id))?.plan?.holes).toEqual({ 'part-0': { 0: 'clear' } }));
  });

  it('offers no clearing once a copy of the part is on a cut board', { timeout: 120_000 }, async () => {
    const bytes = plateStl();
    const job = await createJob(new File([bytes], 'plate.stl'), { name: 'Plate' });
    const copy = new Uint8Array(bytes.slice(0));
    const model = await camWorker().importModel(Comlink.transfer(copy, [copy.buffer]), job.fileName, modelKey(job));
    const boards = reconcileBoards(
      undefined,
      instancesOf(model.parts, () => true),
      'oak'
    ).map(b => ({
      ...b,
      margin: 4,
      size: { fit: false as const, w: 200, h: 130 },
      layout: { w: 200, h: 130, at: { [b.items[0]]: { x: 10, y: 10, rotated: false } } },
      cut: { at: 1, keys: ['ran'] },
    }));
    await saveJob({ ...job, boards });
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );
    expect(await screen.findByText(/the 34 mm piece in a through hole comes loose/, {}, { timeout: 60_000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Clear it/ })).toBeNull();
  });
});

/** THROWAWAY: 3D concept prototypes for the Plan step, to pick one. /cam/poc-3d?v=a|b|c&board=kinderregal|besteck */
import { PageHeader } from '@/components/page-header';
import { usePocBoard, type PocBoardName } from '@/cam/poc3d/usePocBoard';
import { VariantA } from '@/cam/poc3d/VariantA';
import { VariantB } from '@/cam/poc3d/VariantB';
import { VariantC } from '@/cam/poc3d/VariantC';
import { createFileRoute, Link } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { z } from 'zod';

export const Route = createFileRoute('/cam/poc-3d')({
  component: Poc3d,
  validateSearch: zodValidator(z.object({ v: z.enum(['a', 'b', 'c']).optional(), board: z.enum(['kinderregal', 'besteck']).optional() })),
});

const kVariants = { a: 'A · Simulation first', b: 'B · Toolpath layers', c: 'C · Before/after per op' } as const;

function Poc3d() {
  const { v = 'a', board = 'kinderregal' } = Route.useSearch();
  const data = usePocBoard(board as PocBoardName);
  const View = { a: VariantA, b: VariantB, c: VariantC }[v];
  return (
    <div className="flex h-dvh w-full min-w-0 flex-col">
      <PageHeader title="CAM · 3D concepts (prototype)" />
      <div className="flex flex-wrap items-center gap-1 border-b px-4 py-2 text-sm">
        {(Object.keys(kVariants) as (keyof typeof kVariants)[]).map(k => (
          <Link
            key={k}
            to="/cam/poc-3d"
            search={{ v: k, board }}
            className={cn('rounded-md px-3 py-1.5', k === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
            {kVariants[k]}
          </Link>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        {(['kinderregal', 'besteck'] as const).map(b => (
          <Link
            key={b}
            to="/cam/poc-3d"
            search={{ v, board: b }}
            className={cn('rounded-md px-3 py-1.5', b === board ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted')}>
            {b === 'kinderregal' ? 'kinderregal · left side' : 'besteckkasten · vert1'}
          </Link>
        ))}
      </div>
      {data.isError && <p className="m-8 text-destructive">{String(data.error)}</p>}
      {!data.data ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <LoadingSpinner className="size-4" /> Reading the model and making the toolpaths…
        </div>
      ) : (
        <View board={data.data} />
      )}
    </div>
  );
}

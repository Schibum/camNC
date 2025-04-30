import { WritableAtom } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import { ReactNode } from 'react';

export function AtomsHydrator({
  atomValues,
  children,
}: {
  atomValues: Iterable<readonly [WritableAtom<unknown, [any], unknown>, unknown]>;
  children: ReactNode;
}) {
  useHydrateAtoms(new Map(atomValues));
  return children;
}

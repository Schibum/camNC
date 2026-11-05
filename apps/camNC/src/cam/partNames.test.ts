import { describe, expect, it } from 'vitest';
import { instancesOf } from './boards';
import type { CamPartInfo } from './camTypes';
import { bodyNames, isGenericName, withPartNames } from './partNames';
import { uniqueJobName } from './jobDb';

const part = (id: string, names: string[]): CamPartInfo =>
  ({
    id,
    name: names[0],
    names,
    size: [100, 50, 8],
    thickness: 8,
    summary: {},
    shape: { outlines: [], holes: [], pockets: [] },
  }) as unknown as CamPartInfo;

describe('part names', () => {
  it('tells generic CAD names from real ones', () => {
    for (const n of ['Part 1', 'Body2', 'Körper 3', 'part 12']) expect(isGenericName(n)).toBe(true);
    for (const n of ['left', 'top split 1', 'Part']) expect(isGenericName(n)).toBe(false);
  });

  it('names each body of a group of identical unnamed bodies after the group, with a letter', () => {
    expect(bodyNames('Part 1', ['Part 1', 'Part 3'])).toEqual(['Part 1a', 'Part 1b']);
    // Named bodies keep their names.
    expect(bodyNames('Part 7', ['Part 7', 'Part 6', 'Part 5', 'top split 1'])).toEqual(['Part 7a', 'Part 7b', 'Part 7c', 'top split 1']);
    expect(bodyNames('shelf', ['shelf', 'shelf'])).toEqual(['shelf a', 'shelf b']);
    expect(bodyNames('Part 2', ['Part 2'])).toEqual(['Part 2']);
    // Renamed: every body takes the new name.
    expect(bodyNames('Shelf', ['Part 1', 'side'], true)).toEqual(['Shelf a', 'Shelf b']);
  });

  it('uses the job’s names for the parts and their bodies, so Boards, Plan and the G-code show the same', () => {
    const parts = [part('part-0', ['Part 1', 'Part 3']), part('part-1', ['left'])];
    const named = withPartNames(parts, [
      { id: 'part-0', name: 'Part 1' },
      { id: 'part-1', name: 'Left side' },
    ]);
    expect(named.map(p => [p.name, p.modelName, p.names])).toEqual([
      ['Part 1', 'Part 1', ['Part 1a', 'Part 1b']],
      ['Left side', 'left', ['Left side']],
    ]);
    expect(instancesOf(named, () => true).map(i => i.name)).toEqual(['Part 1a', 'Part 1b', 'Left side']);
    // An empty name goes back to the model's.
    expect(withPartNames(parts, [{ id: 'part-1', name: ' ' }])[1].name).toBe('left');
  });

  it('labels a job opened from the same file again', () => {
    expect(uniqueJobName('kinderregal-eiche', [])).toBe('kinderregal-eiche');
    expect(uniqueJobName('kinderregal-eiche', ['kinderregal-eiche'])).toBe('kinderregal-eiche (2)');
    expect(uniqueJobName('kinderregal-eiche', ['kinderregal-eiche', 'kinderregal-eiche (2)'])).toBe('kinderregal-eiche (3)');
  });
});

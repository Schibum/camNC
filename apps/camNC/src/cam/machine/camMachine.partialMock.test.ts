import { expect, it, vi } from 'vitest';
import { getCncApi } from '@/lib/fluidnc/machine';
import { isManufacturingLocked } from './camMachine';

// A partial mock imports the original module while the mocked one is still loading. If camMachine imports back into
// the machine connection again, that waits on itself forever and this file never starts: no test timeout applies.
vi.mock('./camMachine', async importOriginal => ({
  ...(await importOriginal<typeof import('./camMachine')>()),
}));

it('can be partially mocked alongside the machine connection', () => {
  expect(typeof getCncApi).toBe('function');
  expect(isManufacturingLocked()).toBe(false);
});

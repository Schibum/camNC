import { beforeEach } from 'vitest';
import { setImmediate } from 'node:timers/promises';

// Geometry is one long synchronous stretch, and awaits in between don't reach the event loop. A whole file of tests can
// run without a turn for vitest's messages to the main process, whose 60 s timeout then fires (on a busy 2-core runner).
beforeEach(() => setImmediate());

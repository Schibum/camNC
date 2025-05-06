import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectAruco } from './detect-aruco';

// Avoid dynamic import of ensureOpenCvIsLoaded

describe('detectAruco', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await ensureOpenCvIsLoaded();
  });

  it('should detect arucos', async () => {
    const canvas = document.createElement('canvas');
    const markers = detectAruco(canvas);
    expect(markers).toEqual([123]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { videoSource, type VideoSource } from './video-source';
import { acquireVideoSource, getVideoSource, releaseVideoSource, setKeepAliveTime } from './use-video-source';

vi.mock('./video-source', () => ({ videoSource: vi.fn() }));

function createSource(url: string, dispose: () => Promise<void> = vi.fn(async () => {})): VideoSource {
  return {
    params: { type: 'url', url },
    connectedPromise: Promise.resolve({ src: url }),
    dispose,
  };
}

describe('shared video source disposal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(videoSource).mockReset();
    setKeepAliveTime(100);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    setKeepAliveTime(5_000);
  });

  it('keeps a source alive when reacquired during the grace period', async () => {
    const url = 'url://grace-period';
    const source = createSource(url);
    vi.mocked(videoSource).mockReturnValue(source);

    expect(acquireVideoSource(url)).toBe(source);
    releaseVideoSource(url);
    vi.advanceTimersByTime(99);

    expect(acquireVideoSource(url)).toBe(source);
    await vi.advanceTimersByTimeAsync(100);
    expect(source.dispose).not.toHaveBeenCalled();
    expect(videoSource).toHaveBeenCalledTimes(1);

    releaseVideoSource(url);
    await vi.advanceTimersByTimeAsync(100);
    expect(source.dispose).toHaveBeenCalledTimes(1);
  });

  it('creates and retains a replacement when reacquired during asynchronous disposal', async () => {
    const url = 'url://disposal-in-progress';
    let finishDisposal!: () => void;
    const disposing = new Promise<void>(resolve => {
      finishDisposal = resolve;
    });
    const oldSource = createSource(url, vi.fn(() => disposing));
    const newSource = createSource(url);
    vi.mocked(videoSource).mockReturnValueOnce(oldSource).mockReturnValueOnce(newSource);

    acquireVideoSource(url);
    releaseVideoSource(url);
    vi.advanceTimersByTime(100);
    expect(oldSource.dispose).toHaveBeenCalledTimes(1);

    expect(acquireVideoSource(url)).toBe(newSource);
    finishDisposal();
    await disposing;
    expect(getVideoSource(url)).toBe(newSource);
    expect(videoSource).toHaveBeenCalledTimes(2);
    expect(newSource.dispose).not.toHaveBeenCalled();

    releaseVideoSource(url);
    await vi.advanceTimersByTimeAsync(100);
    expect(newSource.dispose).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { videoSource, type VideoSource } from './video-source';
import { acquireVideoSource, disposeIdleVideoSources, getVideoSource, releaseVideoSource, setKeepAliveTime } from './use-video-source';

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
    const oldSource = createSource(
      url,
      vi.fn(() => disposing)
    );
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

  it('disposes idle matching sources at once and leaves sources in use alone', async () => {
    const idle = createSource('rtsp://cam-a/stream');
    const inUse = createSource('rtsp://cam-b/stream');
    const other = createSource('webcam:?deviceId=x');
    vi.mocked(videoSource).mockReturnValueOnce(idle).mockReturnValueOnce(inUse).mockReturnValueOnce(other);
    acquireVideoSource('rtsp://cam-a/stream');
    acquireVideoSource('rtsp://cam-b/stream');
    acquireVideoSource('webcam:?deviceId=x');
    releaseVideoSource('rtsp://cam-a/stream');
    releaseVideoSource('webcam:?deviceId=x');

    disposeIdleVideoSources(url => url.startsWith('rtsp:'));

    expect(idle.dispose).toHaveBeenCalledTimes(1);
    expect(inUse.dispose).not.toHaveBeenCalled();
    expect(other.dispose).not.toHaveBeenCalled();
    const fresh = createSource('rtsp://cam-a/stream');
    vi.mocked(videoSource).mockReturnValueOnce(fresh);
    expect(getVideoSource('rtsp://cam-a/stream')).toBe(fresh);
    // The disposed source's grace timer no longer runs.
    await vi.advanceTimersByTimeAsync(100);
    expect(idle.dispose).toHaveBeenCalledTimes(1);
  });
});

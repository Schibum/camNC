import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRtspGateway } from './rtsp-gateway';
import { videoSource } from './video-source';

describe('rtsp video source', () => {
  afterEach(() => setRtspGateway(null));

  it('fails with a clear message outside the desktop app', async () => {
    const vs = videoSource('rtsp://192.168.1.20/stream');
    await expect(vs.connectedPromise).rejects.toThrow('RTSP cameras need the camNC desktop app');
    await vs.dispose();
  });

  it('asks the gateway for the go2rtc stream of the camera', async () => {
    const gateway = vi.fn().mockRejectedValue(new Error('go2rtc is missing from the app'));
    setRtspGateway(gateway);
    const vs = videoSource('rtsp://admin:pw@192.168.1.20/stream');
    await expect(vs.connectedPromise).rejects.toThrow('go2rtc is missing from the app');
    expect(gateway).toHaveBeenCalledWith('rtsp://admin:pw@192.168.1.20/stream');
  });
});

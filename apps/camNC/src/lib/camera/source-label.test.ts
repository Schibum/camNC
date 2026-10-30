import { describe, expect, it } from 'vitest';
import { cameraSourceDetail, suggestCameraName, uniqueCameraName } from './source-label';

describe('camera names', () => {
  it('names a camera after its source', () => {
    expect(suggestCameraName({ type: 'rtsp', url: 'rtsp://admin:pw@192.168.1.5:554/h264Preview_01_main' })).toBe(
      'Network camera 192.168.1.5'
    );
    expect(suggestCameraName({ type: 'webcam', deviceId: 'x' })).toBe('Webcam');
    expect(suggestCameraName({ type: 'webrtc', accessToken: 't' })).toBe('Phone');
    expect(suggestCameraName({ type: 'go2rtc', host: 'localhost:1984', src: 'reolink' })).toBe('reolink');
    expect(suggestCameraName({ type: 'url', url: 'https://example.com/cam.mp4' })).toBe('example.com');
  });

  it('numbers a name that is taken', () => {
    expect(uniqueCameraName('Phone', [])).toBe('Phone');
    expect(uniqueCameraName('Phone', ['Phone', 'Phone 2'])).toBe('Phone 3');
  });

  it('describes where the video comes from without the login', () => {
    expect(cameraSourceDetail('rtsp://admin:secret@192.168.1.5:554/h264Preview_01_main')).toBe('192.168.1.5 · /h264Preview_01_main');
    expect(cameraSourceDetail('webcam:?deviceId=x')).toBeNull();
  });
});

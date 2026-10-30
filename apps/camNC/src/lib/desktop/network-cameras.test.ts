import { describe, expect, it } from 'vitest';
import { buildRtspUrl, cameraLabel } from './network-cameras';

describe('network cameras', () => {
  it('builds RTSP URLs with the login encoded', () => {
    expect(buildRtspUrl('192.168.1.5', 'admin', 'p@ss$1:x', '/h264Preview_01_main')).toBe(
      'rtsp://admin:p%40ss%241%3Ax@192.168.1.5:554/h264Preview_01_main'
    );
    expect(buildRtspUrl('cam.local', '', '', 'stream1', 8554)).toBe('rtsp://cam.local:8554/stream1');
  });

  it('labels cameras by ONVIF name and model', () => {
    expect(cameraLabel({ host: '1.2.3.4', name: 'Reolink', hardware: 'E1 Zoom', rtsp: true })).toBe('Reolink E1 Zoom');
    expect(cameraLabel({ host: '1.2.3.4', rtsp: true })).toBe('Camera');
  });
});

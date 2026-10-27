/**
 * A read-only FluidNC 3.9.9 controller behind `window.WebSocket`, for the setup smoke test.
 *
 * Connections to ws://<host>/?independent_session fail (3.9.9 has no WebSocket on port 80), so camNC's
 * variant detection falls back to ws://<host>:81/, which this fake serves with the 3.9.9 transport:
 * CURRENT_ID/ACTIVE_ID hello frames and one binary frame per output line. Any motion, zeroing or file
 * command is answered with an error and recorded in `rejected`.
 *
 * It also reports a Chrome 150 user agent so the machine UI is enabled on the HTTPS deployment; the real
 * mixed-content/local-network path is covered by the hardware smoke, not here.
 */
export function installSyntheticFluidNc(host = '192.168.77.7') {
  const config = [
    'name: LowRider',
    'axes:',
    '  x:',
    '    max_travel_mm: 700',
    '    homing:',
    '      positive_direction: false',
    '      mpos_mm: 0',
    '  y:',
    '    max_travel_mm: 550',
    '    homing:',
    '      positive_direction: false',
    '      mpos_mm: 0',
    '  z:',
    '    max_travel_mm: 100',
    '    homing:',
    '      positive_direction: true',
    '      mpos_mm: 0',
  ];
  // Single config items, as camNC reads the travel (`$/axes/x/max_travel_mm=700.000`).
  const items = {
    x: { max_travel_mm: '700.000', 'homing/positive_direction': 'false', 'homing/mpos_mm': '0.000', soft_limits: 'true' },
    y: { max_travel_mm: '550.000', 'homing/positive_direction': 'false', 'homing/mpos_mm': '0.000', soft_limits: 'true' },
    z: { max_travel_mm: '100.000', 'homing/positive_direction': 'true', 'homing/mpos_mm': '0.000', soft_limits: 'true' },
  };
  const responses = {
    '$Report/Interval=200': ['[MSG:INFO: websocket auto report interval set to 200 ms]'],
    $I: ['[VER:3.9 FluidNC v3.9.9 (wifi) :]', '[OPT:PHSW]'],
    $G: ['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]'],
    '$#': ['[G54:20.000,30.000,0.000]', '[G55:0.000,0.000,0.000]'],
    '$Config/Dump': config,
  };
  for (const [axis, values] of Object.entries(items)) {
    for (const [path, value] of Object.entries(values)) responses[`$/axes/${axis}/${path}`] = [`$/axes/${axis}/${path}=${value}`];
  }
  const requests = [];
  const rejected = [];
  window.__camncSmokeFluidNc = { requests, rejected };
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    get: () => ({ brands: [{ brand: 'Google Chrome', version: '150' }], mobile: false, platform: 'Linux' }),
  });

  const RealWebSocket = window.WebSocket;
  const encoder = new TextEncoder();
  class FakeFluidncSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      this.binaryType = 'blob';
      this.buffer = '';
      const accept = url === `ws://${host}:81/`;
      setTimeout(() => {
        if (!accept) {
          this.readyState = 3;
          this.dispatchEvent(new Event('error'));
          this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
          return;
        }
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
        this.dispatchEvent(new MessageEvent('message', { data: 'CURRENT_ID:0' }));
        this.dispatchEvent(new MessageEvent('message', { data: 'ACTIVE_ID:0' }));
      }, 10);
    }
    emit(lines) {
      for (const line of lines) {
        const bytes = encoder.encode(line + '\n');
        setTimeout(() => this.readyState === 1 && this.dispatchEvent(new MessageEvent('message', { data: bytes.buffer })), 0);
      }
    }
    send(data) {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      if (text === '?') {
        this.emit(['<Idle|MPos:125.000,75.000,10.000|FS:0,0|WCO:20.000,30.000,0.000>']);
        return;
      }
      this.buffer += text;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        requests.push(line);
        const response = responses[line];
        if (response) {
          this.emit([...response, 'ok']);
        } else {
          rejected.push(line);
          this.emit(['error:3']);
        }
      }
    }
    close() {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      setTimeout(() => this.dispatchEvent(new CloseEvent('close', { code: 1000 })), 0);
    }
  }
  window.WebSocket = function (url, protocols) {
    return url.startsWith(`ws://${host}`) ? new FakeFluidncSocket(url) : new RealWebSocket(url, protocols);
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, prototype: RealWebSocket.prototype });
}

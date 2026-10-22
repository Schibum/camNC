/**
 * Simulates the read-only WebUI postMessage boundary around the deployed
 * FluidNC extension. The real extension still pairs with camNC over WebRTC.
 * Run the widget in its own page: its window.parent is then the same window.
 */
export function installSyntheticFluidNc() {
  const config = `axes:
  x:
    max_travel_mm: 700
    homing:
      positive_direction: false
      mpos_mm: 0
  y:
    max_travel_mm: 550
    homing:
      positive_direction: false
      mpos_mm: 0
`;
  const requests = [];
  const rejected = [];
  window.__camncSmokeFluidNc = { requests, rejected };
  const send = message => window.postMessage(message, window.location.origin);

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.target !== 'webui') return;
    const request = event.data;
    const record = { type: request.type, content: request.content, url: request.url };
    requests.push(record);
    const reply = response => send({ id: request.id, content: { status: 'success', response } });
    const stream = content => send({ type: 'stream', content });

    if (request.type === 'download' && request.url === '/config.yaml') {
      reply(new Blob([config], { type: 'text/yaml' }));
    } else if (request.type === 'cmd' && request.content === '?') {
      reply('ok');
      stream('<Idle|MPos:125.000,75.000,10.000|WCO:20.000,30.000,0.000>');
    } else if (request.type === 'cmd' && request.content === '$G\n$#') {
      reply('ok');
      stream('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      stream('[G54:20.000,30.000,0.000]');
    } else {
      // Fail closed: this fixture cannot execute movement, zeroing or files.
      rejected.push(record);
      send({ id: request.id, content: { status: 'error', error: 'Synthetic controller only permits read-only requests' } });
    }
  });
}

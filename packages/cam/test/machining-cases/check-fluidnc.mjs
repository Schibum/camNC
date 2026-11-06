// Check generated programs against the repository's local FluidNC simulator.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = new URL(process.argv[2] ?? 'ws://127.0.0.1:18848/?independent_session');
if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  throw new Error('Parser checks require a loopback simulator URL');
const directory = fileURLToPath(new URL('.', import.meta.url));
const files = process.argv.slice(3);
const programsIn = folder => readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry =>
  entry.isDirectory() ? programsIn(`${folder}/${entry.name}`) : entry.name.endsWith('.nc') ? [`${folder}/${entry.name}`] : []);
if (!files.length) files.push(...programsIn(directory));
if (!files.length) throw new Error('No generated programs to check');

const socket = new WebSocket(url);
socket.binaryType = 'arraybuffer';
const encoder = new TextEncoder(), decoder = new TextDecoder();
let partial = '', pending, closedError;
socket.addEventListener('message', event => {
  const text = typeof event.data === 'string' ? event.data : decoder.decode(event.data, { stream: true });
  const lines = (partial + text).split('\n');
  partial = lines.pop() ?? '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!pending) continue;
    if (line === 'ok' || /^(error:|ALARM:)/.test(line) || pending.complete?.test(line)) {
      if (line === 'ok' && pending.complete) continue;
      const current = pending;
      pending = undefined;
      clearTimeout(current.timer);
      if (/^(error:|ALARM:)/.test(line)) current.reject(new Error(`${current.command}: ${line}`));
      else current.resolve([...current.lines, line]);
    } else pending.lines.push(line);
  }
});
socket.addEventListener('close', event => {
  closedError = new Error(`Simulator connection closed (code ${event.code}, clean ${event.wasClean}, reason ${JSON.stringify(event.reason)})`);
  if (pending) { clearTimeout(pending.timer); pending.reject(closedError); pending = undefined; }
});

function send(command, complete, realtime = false) {
  if (pending) throw new Error('Only one parser command may be in flight');
  if (socket.readyState !== WebSocket.OPEN) return Promise.reject(closedError ?? new Error('Simulator connection is not open'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending = undefined; reject(new Error(`Simulator timed out: ${command}`)); }, 5000);
    pending = { command, lines: [], timer, resolve, reject, complete };
    socket.send(encoder.encode(realtime ? command : `${command}\n`));
  });
}

let checkMode = false, checked = 0;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Simulator connection timed out')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Simulator connection failed')); }, { once: true });
  });
  const config = await send('$CD');
  if (!config.some(line => /board:.*\(simulated\)/.test(line))) throw new Error('The connected endpoint is not the repository simulator');
  const version = await send('$I');
  console.log(version.find(line => line.startsWith('[VER:')) ?? 'FluidNC version unavailable');
  const state = await send('?', /^<[^|>]+[|>]/, true);
  if (!state.some(line => /^<Check[|>]/.test(line))) {
    if (!state.some(line => /^<Idle[|>]/.test(line))) throw new Error('Simulator must be idle or already in G-code check mode');
    const enabled = await send('$C');
    if (!enabled.some(line => /Enabled/.test(line))) throw new Error('Simulator did not confirm G-code check mode');
  }
  checkMode = true;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) if (line.trim()) {
      try { await send(line); checked++; } catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
    }
  }
  console.log(`Accepted ${files.length} programs and ${checked} blocks in simulator check mode`);
} finally {
  // Disabling check mode resets the controller; its acknowledgement may be discarded by that reset.
  if (checkMode && socket.readyState === WebSocket.OPEN) await send('$C', /Disabled/).catch(() => {});
  socket.close();
}

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
let partial = '', pending;
socket.addEventListener('message', event => {
  const text = typeof event.data === 'string' ? event.data : decoder.decode(event.data, { stream: true });
  const lines = (partial + text).split('\n');
  partial = lines.pop() ?? '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!pending) continue;
    if (line === 'ok' || /^(error:|ALARM:)/.test(line)) {
      const current = pending;
      pending = undefined;
      clearTimeout(current.timer);
      if (line === 'ok') current.resolve(current.lines);
      else current.reject(new Error(`${current.command}: ${line}`));
    } else pending.lines.push(line);
  }
});
socket.addEventListener('close', () => {
  if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Simulator connection closed')); pending = undefined; }
});

function send(command) {
  if (pending) throw new Error('Only one parser command may be in flight');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending = undefined; reject(new Error(`Simulator timed out: ${command}`)); }, 5000);
    pending = { command, lines: [], timer, resolve, reject };
    socket.send(encoder.encode(`${command}\n`));
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
  const enabled = await send('$C');
  if (!enabled.some(line => /Enabled/.test(line))) throw new Error('Simulator did not confirm G-code check mode');
  checkMode = true;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) if (line.trim()) {
      try { await send(line); checked++; } catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
    }
  }
  console.log(`Accepted ${files.length} programs and ${checked} blocks in simulator check mode`);
} finally {
  if (checkMode && socket.readyState === WebSocket.OPEN) await send('$C').catch(() => {});
  socket.close();
}

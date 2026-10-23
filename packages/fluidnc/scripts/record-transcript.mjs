#!/usr/bin/env node
// Record what a FluidNC controller answers to the commands camNC uses, as a JSON transcript for FakeFluidnc.
//
//   node scripts/record-transcript.mjs 192.168.1.20            # detects 4.x on :80 or 3.9.9 on :81
//   node scripts/record-transcript.mjs 127.0.0.1:8848 > src/testing/transcripts/v4.1.1.json
//
// Only read-only commands are sent. Needs Node 22+ (global WebSocket).

const host = process.argv[2];
if (!host) {
  console.error('usage: record-transcript.mjs <host[:port]>');
  process.exit(1);
}
const commands = ['$I', '$G', '$#', '$Config/Dump', '$SD/ListJSON'];

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => reject(new Error('timeout')), 4000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('unreachable'));
    };
  });
}

const httpPort = Number(host.split(':')[1] ?? 80);
const hostname = host.split(':')[0];
let ws;
let variant = 'v4';
try {
  ws = await open(`ws://${host}/?independent_session`);
} catch {
  variant = 'v3-81';
  ws = await open(`ws://${hostname}:${httpPort + 1}/`);
}

const decoder = new TextDecoder();
const control = [];
let buffer = '';
const lines = [];
let waiter = null;
ws.onmessage = e => {
  if (typeof e.data === 'string') return control.push(e.data);
  buffer += decoder.decode(e.data, { stream: true });
  const parts = buffer.split('\n');
  buffer = parts.pop();
  for (const part of parts) {
    const line = part.replace(/\r$/, '');
    if (!line) continue;
    lines.push(line);
    waiter?.(line);
  }
};

async function command(cmd) {
  const start = lines.length;
  ws.send(new TextEncoder().encode(cmd + '\n'));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ok for ${cmd}`)), 20000);
    waiter = line => {
      if (line === 'ok' || line.startsWith('error:')) {
        clearTimeout(timer);
        resolve();
      }
    };
  });
  return lines.slice(start).filter(line => !line.startsWith('<'));
}

await new Promise(resolve => setTimeout(resolve, 300));
const responses = {};
for (const cmd of commands) responses[cmd] = await command(cmd);
ws.send(new TextEncoder().encode('?'));
await new Promise(resolve => setTimeout(resolve, 300));
const status = lines.filter(line => line.startsWith('<')).slice(-1)[0];
ws.close();

console.log(JSON.stringify({ recordedAt: new Date().toISOString(), host, variant, control, status, responses }, null, 2));

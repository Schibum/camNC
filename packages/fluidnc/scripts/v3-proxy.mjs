// "3.9.9 personality" in front of a FluidNC 4.x simulator.
//
// The G-code/$ protocol is the same in both versions; what differs is the transport. This proxy makes the
// v4 sim look like FluidNC 3.9.9 as camNC sees it on a Jackpot2:
//   - HTTP port P: plain HTTP (proxied to the sim). WebSocket upgrades get a 404, like 3.9.9 on port 80.
//   - port P + 1: the WebUI v2 socket. Hello is CURRENT_ID/ACTIVE_ID, output is one binary frame per line,
//     and text frames (including PING:) are fed to the controller as input instead of being answered.
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

export function startV3Proxy({ simHost, port }) {
  const httpServer = http.createServer((req, res) => {
    const upstream = http.request(`http://${simHost}${req.url}`, { method: req.method, headers: req.headers }, upRes => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    });
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  httpServer.on('upgrade', (_req, socket) => {
    socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  httpServer.listen(port, '127.0.0.1');

  const wss = new WebSocketServer({ port: port + 1, host: '127.0.0.1' });
  wss.on('connection', client => {
    const upstream = new WebSocket(`ws://${simHost}/?independent_session`);
    let partial = '';
    const pending = [];
    upstream.on('open', () => pending.splice(0).forEach(data => upstream.send(data, { binary: true })));
    upstream.on('message', (data, isBinary) => {
      if (!isBinary) {
        const id = String(data).match(/^CURRENT_ID:(\d+)/)?.[1];
        if (id !== undefined) {
          client.send(`CURRENT_ID:${id}`);
          client.send(`ACTIVE_ID:${id}`);
        }
        return;
      }
      const parts = (partial + data.toString('latin1')).split('\n');
      partial = parts.pop();
      for (const line of parts) client.send(Buffer.from(line + '\n', 'latin1'), { binary: true });
    });
    client.on('message', data => {
      // Text and binary frames both go into the channel as bytes, like 3.9.9 does.
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: true });
      else pending.push(data);
    });
    const closeBoth = () => {
      client.close();
      upstream.close();
    };
    client.on('close', closeBoth);
    upstream.on('close', closeBoth);
    upstream.on('error', closeBoth);
  });

  return {
    close: () => {
      httpServer.close();
      wss.close();
    },
  };
}

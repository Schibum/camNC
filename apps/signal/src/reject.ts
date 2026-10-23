/** Accepts and immediately closes a WebSocket, so the client sees the close code. */
export function rejectWebSocket(code: number, reason: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

// An in-process protocol fixture: no sockets or controller connections are opened.
class SimulatorSocket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  commands = [];
  state = process.env.CHECKER_INITIAL_STATE ?? 'Idle';

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = SimulatorSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(bytes) {
    const command = new TextDecoder().decode(bytes).trim();
    this.commands.push(command);
    queueMicrotask(() => {
      if (command === process.env.CHECKER_CLOSE_ON) return this.close(1006, 'fixture transport failure');
      let response;
      if (command === process.env.CHECKER_ERROR_ON) response = 'error:33\n';
      else if (command === '$CD') response = `board: Fixture${process.env.CHECKER_REAL_ENDPOINT ? '' : ' (simulated)'}\nok\n`;
      else if (command === '$I') response = '[VER:fixture]\nok\n';
      else if (command === '?') response = `<${this.state}|MPos:0,0,0>\n`;
      else if (command === '$C') {
        const enabled = this.state !== 'Check';
        this.state = enabled ? 'Check' : 'Idle';
        // A check-mode exit resets firmware and need not deliver a trailing acknowledgement.
        response = enabled ? '[MSG:INFO: Enabled]\nok\n' : '[MSG:INFO: Disabled]\n';
      } else response = 'ok\n';
      this.dispatchEvent(new MessageEvent('message', { data: response }));
    });
  }

  close(code = 1000, reason = '') {
    if (this.readyState === SimulatorSocket.CLOSED) return;
    this.readyState = SimulatorSocket.CLOSED;
    const event = new Event('close');
    Object.assign(event, { code, reason, wasClean: code === 1000 });
    this.dispatchEvent(event);
    console.log(`Fixture commands: ${JSON.stringify(this.commands)}`);
  }
}

globalThis.WebSocket = SimulatorSocket;

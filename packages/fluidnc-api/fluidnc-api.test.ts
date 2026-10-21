import { afterEach, describe, expect, it, vi } from 'vitest';
import { FluidncApi } from './fluidnc-api';

/** Capture requests sent to the WebUI and allow answering them. */
function setup() {
  const sent: any[] = [];
  vi.spyOn(window.parent, 'postMessage').mockImplementation((message: any) => {
    sent.push(message);
  });
  const api = new FluidncApi(1000);
  const reply = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));
  return { api, sent, reply };
}

describe('FluidncApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a command on success', async () => {
    const { api, sent, reply } = setup();
    const promise = api.cmd('?');
    reply({ id: sent[0].id, content: { status: 'success', response: 'ok' } });
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects a command on error', async () => {
    const { api, sent, reply } = setup();
    const promise = api.cmd('?');
    reply({ id: sent[0].id, content: { status: 'error', error: 'nope' } });
    await expect(promise).rejects.toBe('nope');
  });

  it('rejects on unknown status instead of hanging', async () => {
    const { api, sent, reply } = setup();
    const promise = api.cmd('?');
    reply({ id: sent[0].id, content: { status: 'weird' } });
    await expect(promise).rejects.toThrow(/Unknown response status/);
  });

  it('ignores non-object messages', () => {
    setup();
    expect(() => window.dispatchEvent(new MessageEvent('message', { data: null }))).not.toThrow();
  });

  it('emits stream messages', () => {
    const { api, reply } = setup();
    const onStream = vi.fn();
    api.onStream(onStream);
    reply({ type: 'stream', content: 'ok' });
    expect(onStream).toHaveBeenCalledWith({ content: 'ok' });
  });
});

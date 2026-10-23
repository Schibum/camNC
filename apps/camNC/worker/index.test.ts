import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { createHandler, type Auth } from './index';

function handlerFor(userId: string | null) {
  const auth: Auth = {
    getUserId: async () => userId,
    getProfile: vi.fn(async () => ({ name: 'Ada', email: 'ada@example.com' })),
  };
  return { handler: createHandler(auth), auth };
}

function call(handler: ReturnType<typeof createHandler>, init?: RequestInit) {
  const request = new Request('https://run.camnc.app/api/settings', init);
  return handler.fetch!(request as any, env, {} as ExecutionContext);
}

const settings = { json: { state: { toolDiameter: 6 }, version: 1 }, meta: {} };

describe('/api/settings', () => {
  it('rejects requests without a signed-in user', async () => {
    const { handler } = handlerFor(null);
    expect((await call(handler)).status).toBe(401);
    expect((await call(handler, { method: 'PUT', body: JSON.stringify(settings) })).status).toBe(401);
  });

  it('returns 404 before the first save', async () => {
    const { handler } = handlerFor('user_new');
    expect((await call(handler)).status).toBe(404);
  });

  it('saves and loads settings, fetching the profile only on the first save', async () => {
    const { handler, auth } = handlerFor('user_a');
    expect((await call(handler, { method: 'PUT', body: JSON.stringify(settings) })).status).toBe(204);
    const updated = { ...settings, json: { ...settings.json, state: { toolDiameter: 3 } } };
    expect((await call(handler, { method: 'PUT', body: JSON.stringify(updated) })).status).toBe(204);
    expect(auth.getProfile).toHaveBeenCalledTimes(1);

    const resp = await call(handler);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ settings: updated });
    const row = await env.DB.prepare('select name, email from users where id = ?').bind('user_a').first();
    expect(row).toEqual({ name: 'Ada', email: 'ada@example.com' });
  });

  it('keeps users apart', async () => {
    await call(handlerFor('user_b').handler, { method: 'PUT', body: JSON.stringify(settings) });
    expect((await call(handlerFor('user_c').handler)).status).toBe(404);
  });

  it('rejects invalid bodies', async () => {
    const { handler } = handlerFor('user_d');
    expect((await call(handler, { method: 'PUT', body: 'not json' })).status).toBe(400);
    expect((await call(handler, { method: 'PUT', body: '[1]' })).status).toBe(400);
    expect((await call(handler, { method: 'PUT', body: 'x'.repeat(1_000_001) })).status).toBe(413);
  });

  it('rejects other methods', async () => {
    expect((await call(handlerFor('user_e').handler, { method: 'DELETE' })).status).toBe(405);
  });
});

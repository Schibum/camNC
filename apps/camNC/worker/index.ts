import { createClerkClient } from '@clerk/backend';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { users } from './schema';

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  /** PEM public key of the Clerk instance, lets us verify sessions without a network call. */
  CLERK_JWT_KEY?: string;
}

export interface UserProfile {
  name: string;
  email: string;
}

/** Auth hooks, replaced in tests. */
export interface Auth {
  getUserId(request: Request, env: Env): Promise<string | null>;
  getProfile(userId: string, env: Env): Promise<UserProfile>;
}

function clerk(env: Env) {
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    jwtKey: env.CLERK_JWT_KEY,
  });
}

export const clerkAuth: Auth = {
  async getUserId(request, env) {
    const state = await clerk(env).authenticateRequest(request, { jwtKey: env.CLERK_JWT_KEY });
    return state.isAuthenticated ? state.toAuth().userId : null;
  },
  async getProfile(userId, env) {
    const user = await clerk(env).users.getUser(userId);
    return { name: user.fullName ?? '', email: user.primaryEmailAddress?.emailAddress ?? '' };
  },
};

const MAX_SETTINGS_BYTES = 1_000_000;

async function handleSettings(request: Request, env: Env, auth: Auth): Promise<Response> {
  const userId = await auth.getUserId(request, env);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const db = drizzle(env.DB);

  if (request.method === 'GET') {
    const row = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).get();
    if (!row) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ settings: row.settings });
  }

  if (request.method === 'PUT') {
    const body = await request.text();
    if (body.length > MAX_SETTINGS_BYTES) return Response.json({ error: 'too large' }, { status: 413 });
    let settings: unknown;
    try {
      settings = JSON.parse(body);
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      return Response.json({ error: 'settings must be an object' }, { status: 400 });
    }
    const updatedAt = new Date().toISOString();
    const updated = await db.update(users).set({ settings, updatedAt }).where(eq(users.id, userId)).returning({ id: users.id });
    if (updated.length === 0) {
      // First save: look up name and email once instead of on every save.
      const profile = await auth.getProfile(userId, env);
      await db
        .insert(users)
        .values({ id: userId, settings, updatedAt, ...profile })
        .onConflictDoUpdate({ target: users.id, set: { settings, updatedAt } });
    }
    return new Response(null, { status: 204 });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET, PUT' } });
}

/** Public client config, so one build serves production and previews (each with its own Clerk instance). */
function handleConfig(env: Env): Response {
  return Response.json({ clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY }, { headers: { 'Cache-Control': 'no-cache' } });
}

export function createHandler(auth: Auth): ExportedHandler<Env> {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/api/config') return handleConfig(env);
      if (url.pathname === '/api/settings') return handleSettings(request, env, auth);
      if (url.pathname.startsWith('/api/')) return Response.json({ error: 'not found' }, { status: 404 });
      return env.ASSETS.fetch(request);
    },
  };
}

export default createHandler(clerkAuth);

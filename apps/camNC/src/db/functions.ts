import { clerkClient } from '@clerk/tanstack-react-start/server';
import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import z from 'zod';
import { getDb, getSafeAuth, schema } from './db';
import { users } from './schema';

// Note: exported serverFns need to be in a (this) separate file, other than the db.ts file,
// see https://github.com/TanStack/router/issues/2783#issuecomment-2569198718

export const loadUserSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await getSafeAuth();
  if (!auth?.userId) return null;
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, auth.userId),
    columns: {
      settings: true,
    },
  });
  return user?.settings;
});

export const updateUserSettings = createServerFn({ method: 'POST' })
  .validator(z.record(z.string(), z.any()))
  .handler(async ({ data }) => {
    const auth = await getSafeAuth();
    if (!auth?.userId) return null;
    const fullUser = await clerkClient().users.getUser(auth.userId);

    const db = getDb();
    const userData: typeof schema.users.$inferInsert = {
      id: auth.userId,
      settings: data,
      name: fullUser.fullName ?? '',
      email: fullUser.primaryEmailAddress?.emailAddress ?? '',
    };
    await db
      .insert(schema.users)
      .values(userData)
      .onConflictDoUpdate({
        target: [schema.users.id],
        set: userData,
      });
  });

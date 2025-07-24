import { jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: varchar({ length: 255 }).primaryKey(),
  settings: jsonb().$type<Record<string, any>>().notNull().default({ foo: 'bar' }),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
});

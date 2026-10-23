import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text().primaryKey(),
  // superjson-serialized zustand persist value ({ json, meta }).
  settings: text({ mode: 'json' }).$type<unknown>().notNull(),
  name: text().notNull(),
  email: text().notNull(),
  updatedAt: text('updated_at').notNull(),
});

import { neon } from '@neondatabase/serverless';

let client: ReturnType<typeof neon>;

export function getDbClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!client) {
    client = neon(process.env.DATABASE_URL!);
  }
  return client;
}

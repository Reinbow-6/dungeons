import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DungeonsDb = PostgresJsDatabase<typeof schema>;

let cachedClient: ReturnType<typeof postgres> | null = null;
let cachedDb: DungeonsDb | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

/**
 * Lazy Postgres/Drizzle singleton configured for Supabase Transaction Pooler (port 6543).
 * Safe to import during `next build` without requiring DATABASE_URL at build time.
 */
export function getDb(): DungeonsDb {
  if (cachedDb) {
    return cachedDb;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !connectionString.trim()) {
    throw new Error(
      "DATABASE_URL no está configurada. Definila en .env.local usando el pooler de Supabase.",
    );
  }

  cachedClient = postgres(connectionString, {
    prepare: false, // Requerido por Supavisor/PgBouncer Transaction Mode (puerto 6543)
    max: 5,
    idle_timeout: 20,
  });
  cachedDb = drizzle(cachedClient, { schema });
  return cachedDb;
}

export { schema };

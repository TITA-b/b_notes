import "server-only";

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Falta configurar DATABASE_URL para PostgreSQL.");
  }
  pool ??= new Pool({ connectionString });
  return pool;
}

export async function ensureDatabaseSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const database = getPool();
      await database.query(`
        CREATE TABLE IF NOT EXISTS users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email text NOT NULL UNIQUE,
          password_hash text NOT NULL,
          templates_seeded boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS areas (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          slug text NOT NULL,
          name text NOT NULL,
          icon text NOT NULL,
          color text NOT NULL,
          position integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, slug),
          UNIQUE (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS notes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          area text NOT NULL,
          title text NOT NULL,
          content text NOT NULL DEFAULT '',
          links jsonb NOT NULL DEFAULT '[]'::jsonb,
          periodic_key text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          FOREIGN KEY (user_id, area) REFERENCES areas(user_id, slug)
            ON UPDATE CASCADE ON DELETE RESTRICT
        );
        ALTER TABLE notes ADD COLUMN IF NOT EXISTS periodic_key TEXT;
        CREATE TABLE IF NOT EXISTS tasks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          area text NOT NULL,
          title text NOT NULL,
          due_date timestamptz,
          completed boolean NOT NULL DEFAULT false,
          sync_to_gcal boolean NOT NULL DEFAULT false,
          gcal_event_id text,
          attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
          note_id text,
          created_at timestamptz NOT NULL DEFAULT now(),
          FOREIGN KEY (user_id, area) REFERENCES areas(user_id, slug)
            ON UPDATE CASCADE ON DELETE RESTRICT
        );
        ALTER TABLE tasks ADD COLUMN IF NOT EXISTS note_id TEXT;
        CREATE TABLE IF NOT EXISTS note_templates (
          id text NOT NULL,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name text NOT NULL,
          area_slug text,
          default_title text NOT NULL DEFAULT '',
          content text NOT NULL DEFAULT '',
          position integer NOT NULL DEFAULT 0,
          is_default boolean NOT NULL DEFAULT false,
          PRIMARY KEY (user_id, id)
        );
        CREATE TABLE IF NOT EXISTS ai_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role text NOT NULL CHECK (role IN ('user', 'assistant')),
          content text NOT NULL,
          area text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS google_tokens (
          user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          access_token text NOT NULL DEFAULT '',
          refresh_token text,
          expiry_date bigint,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          endpoint TEXT UNIQUE NOT NULL,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS areas_user_position_idx
          ON areas(user_id, position);
        CREATE INDEX IF NOT EXISTS notes_user_area_updated_idx
          ON notes(user_id, area, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notes_fts
          ON notes USING GIN (
            to_tsvector(
              'spanish',
              coalesce(title, '') || ' ' || coalesce(content, '')
            )
          );
        CREATE UNIQUE INDEX IF NOT EXISTS notes_user_periodic_key_unique_idx
          ON notes(user_id, periodic_key)
          WHERE periodic_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS tasks_user_area_due_idx
          ON tasks(user_id, area, completed, due_date, created_at DESC);
        CREATE INDEX IF NOT EXISTS tasks_user_gcal_event_idx
          ON tasks(user_id, gcal_event_id);
        CREATE INDEX IF NOT EXISTS tasks_user_note_idx
          ON tasks(user_id, note_id);
        CREATE INDEX IF NOT EXISTS note_templates_user_position_idx
          ON note_templates(user_id, position);
        CREATE INDEX IF NOT EXISTS ai_messages_user_created_idx
          ON ai_messages(user_id, created_at DESC);
      `);
    })();
  }

  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}

export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<Row>> {
  await ensureDatabaseSchema();
  return getPool().query<Row>(text, values);
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  await ensureDatabaseSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * SQLite schema for the corpus index.
 *
 * The database is a disposable derived index that lives in its own file. It
 * must never share a file with another derived index: `dsh-session-query-sqlite`
 * refuses a database whose `application_id` belongs to someone else and drops
 * every table when `user_version` moves, so a shared file would be reset out
 * from under this store. {@link openCorpusDatabase} enforces the same
 * ownership rules in the other direction.
 *
 * @module @deepseek-ai/dsh-meteo-corpus/schema
 */

import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** Opaque owner stamp written to `PRAGMA application_id`. */
export const CORPUS_APPLICATION_ID = 0x4d544351

/** Current schema version; a mismatch resets the derived index in place. */
export const CORPUS_SCHEMA_VERSION = 1

/** Journal modes a deployment may select for the index file. */
export type CorpusJournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** Tables this store owns, including the FTS5 shadow tables. */
const OWNED_TABLES: readonly string[] = [
  'docs',
  'chunks',
  'chunks_fts',
  'chunks_fts_data',
  'chunks_fts_idx',
  'chunks_fts_content',
  'chunks_fts_docsize',
  'chunks_fts_config',
]

/**
 * Resolve a configured index path to an absolute file path.
 *
 * `:memory:` passes through unchanged so a deployment (or a test) can run the
 * index without touching disk.
 *
 * @param configured - the path from plugin configuration.
 * @param cwd - base directory for a relative path.
 * @returns the absolute index path, or `:memory:`.
 */
export function resolveCorpusPath(configured: string, cwd: string): string {
  return configured === ':memory:' ? configured : resolve(cwd, configured)
}

/** Tables a fresh or reset index holds, in creation order. */
const DDL: readonly string[] = [
  `CREATE TABLE docs (
     doc_id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     source TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     ingested_at INTEGER NOT NULL,
     chunk_count INTEGER NOT NULL
   ) STRICT`,
  `CREATE TABLE chunks (
     doc_id TEXT NOT NULL,
     ordinal INTEGER NOT NULL,
     heading_path TEXT NOT NULL,
     char_start INTEGER NOT NULL,
     char_end INTEGER NOT NULL,
     text TEXT NOT NULL,
     tokens TEXT NOT NULL,
     PRIMARY KEY (doc_id, ordinal)
   ) STRICT`,
  `CREATE VIRTUAL TABLE chunks_fts USING fts5(
     tokens,
     doc_id UNINDEXED,
     ordinal UNINDEXED,
     tokenize = 'unicode61'
   )`,
]

/** Tables a created index must contain, used to detect a foreign file. */
export const CORPUS_TABLES: readonly string[] = ['docs', 'chunks']

/** Names of every user table currently in the database. */
function listUserTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  return rows.map(row => row.name)
}

/** Drop every owned table, then stamp the current version. */
function resetSchema(db: DatabaseSync): void {
  for (const table of OWNED_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`)
  db.exec(`PRAGMA user_version = ${CORPUS_SCHEMA_VERSION}`)
}

/**
 * Open (creating if absent) the corpus index file and return a usable handle.
 *
 * Ownership rules, mirroring the sibling derived index:
 * - a non-zero `application_id` that is not ours is a hard error;
 * - an `application_id` of zero over an existing user table is a hard error;
 * - our own id with a different `user_version` resets the index in place,
 *   which is safe because every row is derived from re-ingestible sources.
 *
 * @param path - absolute path of the index file.
 * @param journalMode - journal mode applied after the ownership check.
 * @returns the opened database, with schema guaranteed current.
 */
export async function openCorpusDatabase(path: string, journalMode: CorpusJournalMode): Promise<DatabaseSync> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // Dynamic on purpose: `node:sqlite` still emits an ExperimentalWarning at
  // module evaluation on Node 22, and a static import would emit it for every
  // process that loads these plugins whether or not it opens a corpus.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path)
  const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (applicationId !== 0 && applicationId !== CORPUS_APPLICATION_ID) {
    db.close()
    throw new Error(
      `meteo-corpus: ${path} belongs to another application (application_id ${applicationId}); ` +
        'configure a dedicated database file for the corpus index.',
    )
  }
  if (applicationId === 0 && listUserTables(db).length > 0) {
    db.close()
    throw new Error(
      `meteo-corpus: ${path} already holds tables but declares no owner; ` +
        'configure a dedicated database file for the corpus index.',
    )
  }
  const schemaless = applicationId === 0
  const current = !schemaless && version === CORPUS_SCHEMA_VERSION
  if (!current) {
    // A version move resets first: `CREATE TABLE` is not `IF NOT EXISTS`, so a
    // stale schema must be dropped rather than collided with.
    if (!schemaless) resetSchema(db)
    for (const statement of DDL) db.exec(statement)
  }
  db.exec(`PRAGMA application_id = ${CORPUS_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${CORPUS_SCHEMA_VERSION}`)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`PRAGMA journal_mode = ${journalMode}`)
  return db
}

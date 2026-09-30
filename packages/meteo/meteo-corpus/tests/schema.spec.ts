/**
 * Tests for the corpus index file's ownership rules: a fresh file is created,
 * a foreign file and an unowned non-empty file are refused, and a version move
 * resets the derived index in place.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CORPUS_APPLICATION_ID,
  CORPUS_SCHEMA_VERSION,
  openCorpusDatabase,
  resolveCorpusPath,
} from '@deepseek-ai/dsh-meteo-corpus'

const roots: string[] = []

async function temporaryPath(name = 'corpus.sqlite'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'meteo-corpus-'))
  roots.push(root)
  return join(root, name)
}

async function withRawDatabase<T>(path: string, body: (db: import('node:sqlite').DatabaseSync) => T): Promise<T> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path)
  try {
    return body(db)
  } finally {
    db.close()
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('resolveCorpusPath', () => {
  it('resolves a relative path against the supplied directory', () => {
    const base = join(tmpdir(), 'base')
    expect(resolveCorpusPath('meteo/corpus.sqlite', base)).toBe(join(base, 'meteo', 'corpus.sqlite'))
  })
  it('keeps an absolute path', () => {
    const absolute = join(tmpdir(), 'somewhere', 'corpus.sqlite')
    expect(resolveCorpusPath(absolute, '/base')).toBe(absolute)
  })

  it('passes the in-memory sentinel through untouched', () => {
    expect(resolveCorpusPath(':memory:', '/base')).toBe(':memory:')
  })
})

describe('openCorpusDatabase', () => {
  it('creates the schema and stamps ownership', async () => {
    const path = await temporaryPath()
    const db = await openCorpusDatabase(path, 'wal')
    try {
      const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as {
        application_id: number
      }
      const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(applicationId).toBe(CORPUS_APPLICATION_ID)
      expect(version).toBe(CORPUS_SCHEMA_VERSION)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'chunks_fts'").all()).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('reopens an existing index without losing rows', async () => {
    const path = await temporaryPath()
    const first = await openCorpusDatabase(path, 'wal')
    first.prepare('INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?)').run('d1', 't', 's', 1, 1, 0)
    first.close()
    const second = await openCorpusDatabase(path, 'delete')
    try {
      expect(second.prepare('SELECT doc_id FROM docs').all()).toHaveLength(1)
    } finally {
      second.close()
    }
  })

  it('refuses a file owned by another application', async () => {
    const path = await temporaryPath()
    await withRawDatabase(path, (db) => { db.exec('PRAGMA application_id = 123456') })
    await expect(openCorpusDatabase(path, 'wal')).rejects.toThrow(/belongs to another application/)
  })

  it('refuses a non-empty file that declares no owner', async () => {
    const path = await temporaryPath()
    await withRawDatabase(path, (db) => { db.exec('CREATE TABLE other (x TEXT)') })
    await expect(openCorpusDatabase(path, 'wal')).rejects.toThrow(/declares no owner/)
  })

  it('resets an index whose schema version moved', async () => {
    const path = await temporaryPath()
    const first = await openCorpusDatabase(path, 'wal')
    first.prepare('INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?)').run('stale', 't', 's', 1, 1, 0)
    first.exec(`PRAGMA user_version = ${CORPUS_SCHEMA_VERSION + 1}`)
    first.close()
    const second = await openCorpusDatabase(path, 'wal')
    try {
      expect(second.prepare('SELECT doc_id FROM docs').all()).toHaveLength(0)
      expect(second.prepare('PRAGMA user_version').get()).toEqual({ user_version: CORPUS_SCHEMA_VERSION })
    } finally {
      second.close()
    }
  })
})

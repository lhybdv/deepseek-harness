/**
 * SQLite-backed corpus store: the shipped implementation of `ctx.corpus`.
 *
 * Documents are chunked by {@link chunkText} and indexed by the bigram token
 * form of {@link indexTokens}; retrieval issues the OR expression from
 * {@link buildMatchExpression} and ranks with FTS5's own BM25. The handle is
 * opened lazily on first use so a composition that mounts this plugin but never
 * ingests or searches pays nothing.
 *
 * @module @deepseek-ai/dsh-meteo-corpus/sqlite
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import z from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CorpusStore } from './definition.ts'
import { buildMatchExpression } from './match.ts'
import { openCorpusDatabase, resolveCorpusPath, type CorpusJournalMode } from './schema.ts'
import { chunkText, indexTokens } from './text.ts'
import type {
  CorpusChunk,
  CorpusDocument,
  CorpusDocumentId,
  CorpusHit,
  IngestFailure,
  IngestRequest,
  IngestResult,
  RemoveResult,
  SearchRequest,
  SearchResult,
} from './types.ts'

/** Plugin config: every execution bound, changeable from `cordis.yml`. */
export interface Config {
  /** Index database path; relative paths resolve against the process working directory. */
  path: string
  /** SQLite journal mode for the index file. */
  journalMode: CorpusJournalMode
  /** Hits returned when a search omits `limit`. */
  defaultLimit: number
  /** Largest `limit` a search may request. */
  maxLimit: number
  /** Upper bound on distinct MATCH tokens per query, bounding expression size. */
  maxMatchTokens: number
  /** Soft upper bound on a chunk's character count. */
  maxChunkChars: number
  /** Largest accepted document, in UTF-8 bytes. */
  maxDocumentBytes: number
}

/** A document plus its OR-joined expansion terms is never worth an unbounded query. */
const MIN_LIMIT = 1

/** One row of the joined retrieval query. */
interface HitRow {
  doc_id: string
  ordinal: number
  heading_path: string
  char_start: number
  char_end: number
  text: string
  title: string
  score: number
}

/** One row of the document listing. */
interface DocumentRow {
  doc_id: string
  title: string
  source: string
  bytes: number
  ingested_at: number
  chunk_count: number
}

function toDocument(row: DocumentRow): CorpusDocument {
  return {
    docId: brandString<CorpusDocumentId>(row.doc_id),
    title: row.title,
    source: row.source,
    bytes: row.bytes,
    ingestedAt: row.ingested_at,
    chunkCount: row.chunk_count,
  }
}

function toHit(row: HitRow): CorpusHit {
  return {
    docId: brandString<CorpusDocumentId>(row.doc_id),
    ordinal: row.ordinal,
    headingPath: row.heading_path,
    charStart: row.char_start,
    charEnd: row.char_end,
    text: row.text,
    docTitle: row.title,
    score: row.score,
  }
}

/**
 * Corpus store backed by one SQLite file with an FTS5 bigram index.
 *
 * Loading this plugin registers it as `ctx.corpus`; a second corpus provider in
 * the same context throws cordis' duplicate-service error.
 */
export class SqliteCorpusStore extends CorpusStore {
  static Config: z<Config> = z.object({
    path: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    defaultLimit: z.number().default(8),
    maxLimit: z.number().default(50),
    maxMatchTokens: z.number().default(64),
    maxChunkChars: z.number().default(800),
    maxDocumentBytes: z.number().default(4_000_000),
  })

  private opening: Promise<DatabaseSync> | undefined
  private closing: Promise<void> | undefined
  private closed = false

  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx)
    for (const [name, value] of Object.entries({
      defaultLimit: config.defaultLimit,
      maxLimit: config.maxLimit,
      maxMatchTokens: config.maxMatchTokens,
      maxChunkChars: config.maxChunkChars,
      maxDocumentBytes: config.maxDocumentBytes,
    })) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`meteo-corpus: ${name} must be a positive integer`)
      }
    }
    if (config.defaultLimit > config.maxLimit) {
      throw new Error('meteo-corpus: defaultLimit must not exceed maxLimit')
    }
    ctx.effect(() => async () => this.close(), 'meteo-corpus: close index')
  }

  private open(): Promise<DatabaseSync> {
    if (this.closed) return Promise.reject(new Error('meteo-corpus: the corpus index is closed'))
    this.opening ??= openCorpusDatabase(resolveCorpusPath(this.config.path, process.cwd()), this.config.journalMode)
    return this.opening
  }

  /**
   * Release the index handle. Plugin disposal calls this, so reloading a
   * composition does not leak the file lock; repeated calls await the same
   * close.
   * @returns a promise that settles once the handle is released.
   */
  close(): Promise<void> {
    this.closing ??= this.release()
    return this.closing
  }

  private async release(): Promise<void> {
    this.closed = true
    const opening = this.opening
    // An open that never ran, or one that failed, holds no handle to release.
    if (opening === undefined) return
    const db = await opening.catch(() => undefined)
    db?.close()
  }

  override async ingest(request: IngestRequest): Promise<IngestResult> {
    const db = await this.open()
    const documents: CorpusDocument[] = []
    const failures: IngestFailure[] = []
    for (const source of request.sources) {
      const text = source.text.trim()
      if (text.length === 0) {
        failures.push({
          title: source.title,
          code: 'CORPUS_EMPTY_DOCUMENT',
          message: 'the source text is empty after trimming',
        })
        continue
      }
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > this.config.maxDocumentBytes) {
        failures.push({
          title: source.title,
          code: 'CORPUS_DOCUMENT_TOO_LARGE',
          message: `the source is ${bytes} bytes, above the configured limit of ${this.config.maxDocumentBytes}`,
        })
        continue
      }
      const drafts = chunkText(text, this.config.maxChunkChars)
      const docId = brandString<CorpusDocumentId>(randomUUID())
      const ingestedAt = Date.now()
      const insertChunk = db.prepare('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?)')
      const insertFts = db.prepare('INSERT INTO chunks_fts (tokens, doc_id, ordinal) VALUES (?, ?, ?)')
      for (const [ordinal, draft] of drafts.entries()) {
        const tokens = indexTokens(`${draft.headingPath}\n${draft.text}`)
        insertChunk.run(docId, ordinal, draft.headingPath, draft.charStart, draft.charEnd, draft.text, tokens)
        insertFts.run(tokens, docId, ordinal)
      }
      // The document row is written last and is the visibility gate: retrieval
      // joins through it, so an ingest interrupted part-way leaves only chunk
      // rows no query returns, rather than a document reporting a count it does
      // not have. That is why these writes need no explicit transaction.
      db.prepare('INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?)').run(
        docId,
        source.title,
        source.source,
        bytes,
        ingestedAt,
        drafts.length,
      )
      documents.push({ docId, title: source.title, source: source.source, bytes, ingestedAt, chunkCount: drafts.length })
    }
    return { documents, failures }
  }

  override async search(request: SearchRequest): Promise<SearchResult> {
    const db = await this.open()
    const matchExpression = buildMatchExpression(request.query, request.terms ?? [], this.config.maxMatchTokens)
    if (matchExpression.length === 0) return { hits: [], matchExpression }
    const requested = request.limit ?? this.config.defaultLimit
    const limit = Math.min(Math.max(requested, MIN_LIMIT), this.config.maxLimit)
    const rows = db
      .prepare(
        `SELECT c.doc_id, c.ordinal, c.heading_path, c.char_start, c.char_end, c.text,
                d.title, bm25(chunks_fts) AS score
           FROM chunks_fts
           JOIN chunks c ON c.doc_id = chunks_fts.doc_id AND c.ordinal = chunks_fts.ordinal
           JOIN docs d ON d.doc_id = c.doc_id
          WHERE chunks_fts MATCH ?
          ORDER BY score
          LIMIT ?`,
      )
      .all(matchExpression, limit) as unknown as HitRow[]
    return { hits: rows.map(toHit), matchExpression }
  }

  override async readChunk(docId: CorpusDocumentId, ordinal: number): Promise<CorpusChunk | undefined> {
    const db = await this.open()
    const row = db
      .prepare('SELECT heading_path, char_start, char_end, text FROM chunks WHERE doc_id = ? AND ordinal = ?')
      .get(docId, ordinal) as { heading_path: string; char_start: number; char_end: number; text: string } | undefined
    if (row === undefined) return undefined
    return {
      docId,
      ordinal,
      headingPath: row.heading_path,
      charStart: row.char_start,
      charEnd: row.char_end,
      text: row.text,
    }
  }

  override async listDocuments(limit?: number): Promise<CorpusDocument[]> {
    const db = await this.open()
    const statement =
      'SELECT doc_id, title, source, bytes, ingested_at, chunk_count FROM docs ORDER BY ingested_at DESC, doc_id'
    const rows = (
      limit === undefined
        ? db.prepare(statement).all()
        : db.prepare(`${statement} LIMIT ?`).all(Math.max(limit, MIN_LIMIT))
    ) as unknown as DocumentRow[]
    return rows.map(toDocument)
  }

  override async remove(docId: CorpusDocumentId): Promise<RemoveResult> {
    const db = await this.open()
    db.prepare('DELETE FROM chunks_fts WHERE doc_id = ?').run(docId)
    db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId)
    const removed = db.prepare('DELETE FROM docs WHERE doc_id = ?').run(docId).changes > 0
    return { docId, removed }
  }
}

export default SqliteCorpusStore

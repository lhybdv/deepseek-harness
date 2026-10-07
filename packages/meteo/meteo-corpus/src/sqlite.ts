/**
 * SQLite-backed corpus store: the shipped implementation of `ctx.corpus`.
 *
 * Documents are chunked by {@link chunkText} and indexed by the bigram token
 * form of {@link indexTokens}; retrieval issues the OR expression from
 * {@link buildMatchExpression} and ranks with FTS5's own BM25. The handle is
 * opened lazily on first use so a composition that mounts this plugin but never
 * ingests or searches pays nothing.
 *
 * Vector recall is an optional peer. The store reads `ctx.textEmbeddings` at the
 * point of use, so a provider mounted later in the same composition still takes
 * effect: with the registry present it stores one vector per chunk and fuses
 * vector recall into every query, and without it the store writes no vectors,
 * answers lexically, and reports the missing service once.
 *
 * @module @deepseek-ai/dsh-meteo-corpus/sqlite
 */

import type TextEmbeddings from '@deepseek-ai/dsh-text-embeddings'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import z from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CorpusStore } from './definition.ts'
import { buildMatchExpression } from './match.ts'
import { cosineSimilarity, fuseRanks, type RankedChunk } from './fusion.ts'
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
  /** Max chunks embedded in one provider request. */
  embeddingBatchSize: number
  /** Number of lexical and semantic candidates fused per query. */
  candidateLimit: number
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
/** Parse a durable vector value and reject corrupt or non-finite contents.
 * @param value - serialized SQLite vector.
 * @returns a finite non-empty numeric vector.
 */
function parseVector(value: string): number[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) }
  catch { throw new Error('meteo-corpus: stored embedding vector is invalid JSON') }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('meteo-corpus: stored embedding vector is malformed')
  }
  return parsed
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
    embeddingBatchSize: z.number().default(32),
    candidateLimit: z.number().default(100),
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
      embeddingBatchSize: config.embeddingBatchSize,
      candidateLimit: config.candidateLimit,
    })) {
      if (!Number.isInteger(value) || value < 1) throw new Error(`meteo-corpus: ${name} must be a positive integer`)
    }
    if (config.defaultLimit > config.maxLimit) throw new Error('meteo-corpus: defaultLimit must not exceed maxLimit')
    ctx.effect(() => async () => this.close(), 'meteo-corpus: close index')
  }

  /** Latched by the first lexical fallback so one store reports the missing peer once. */
  private reportedMissingEmbeddings = false

  /**
   * Resolve the optional embedding capability for one operation.
   *
   * The lookup happens at the point of use rather than at construction, so a
   * provider mounted after this store still joins the fused path and mounting
   * order stays irrelevant. A composition with no registry is not an error: the
   * store keeps working lexically, and the first such fallback names the missing
   * service so an operator learns why recall has no semantic half.
   * @returns the embedding registry, or `undefined` when none is mounted.
   */
  private embeddings(): TextEmbeddings | undefined {
    const embeddings = this.ctx.get('textEmbeddings') as TextEmbeddings | undefined
    if (embeddings !== undefined) return embeddings
    if (!this.reportedMissingEmbeddings) {
      this.reportedMissingEmbeddings = true
      this.ctx.logger.warn(
        'meteo-corpus: no textEmbeddings provider is mounted; ingest stores no vectors and search retrieves lexically only',
      )
    }
    return undefined
  }

  private async embed(
    embeddings: TextEmbeddings,
    kind: 'documents' | 'queries',
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    const vectors: (readonly number[])[] = []
    for (let start = 0; start < texts.length; start += this.config.embeddingBatchSize) {
      const batch = texts.slice(start, start + this.config.embeddingBatchSize)
      const spec = embeddings.resolve({ texts: batch, kind })
      vectors.push(...await embeddings.embed(spec))
    }
    return vectors
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
      const embeddings = this.embeddings()
      const vectors = embeddings === undefined
        ? undefined
        : await this.embed(embeddings, 'documents', drafts.map(draft => `${draft.headingPath}\n${draft.text}`))
      const docId = brandString<CorpusDocumentId>(randomUUID())
      const ingestedAt = Date.now()
      const insertChunk = db.prepare('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?)')
      const insertFts = db.prepare('INSERT INTO chunks_fts (tokens, doc_id, ordinal) VALUES (?, ?, ?)')
      const insertVector = db.prepare('INSERT INTO chunk_vectors VALUES (?, ?, ?, ?)')
      for (const [ordinal, draft] of drafts.entries()) {
        const tokens = indexTokens(`${draft.headingPath}\n${draft.text}`)
        insertChunk.run(docId, ordinal, draft.headingPath, draft.charStart, draft.charEnd, draft.text, tokens)
        insertFts.run(tokens, docId, ordinal)
        // Without a provider the chunk row and its FTS row are the whole record:
        // the vector table stays empty rather than holding a fabricated vector.
        if (vectors === undefined) continue
        const vector = vectors[ordinal]
        if (vector === undefined) throw new Error('Embedding provider omitted a document vector')
        insertVector.run(docId, ordinal, vector.length, JSON.stringify(vector))
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
    const requested = request.limit ?? this.config.defaultLimit
    const limit = Math.min(Math.max(requested, MIN_LIMIT), this.config.maxLimit)
    const lexical = matchExpression.length === 0 ? [] : db
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
      .all(matchExpression, this.config.candidateLimit) as unknown as HitRow[]
    const embeddings = this.embeddings()
    const queryVector = embeddings === undefined
      ? undefined
      : (await this.embed(embeddings, 'queries', [request.query]))[0]
    if (embeddings !== undefined && queryVector === undefined) {
      throw new Error('Embedding provider omitted the query vector')
    }
    const vectors = (embeddings === undefined ? [] : db.prepare(
      `SELECT c.doc_id, c.ordinal, c.heading_path, c.char_start, c.char_end, c.text,
              d.title, v.dimensions, v.vector
         FROM chunk_vectors v
         JOIN chunks c ON c.doc_id = v.doc_id AND c.ordinal = v.ordinal
         JOIN docs d ON d.doc_id = c.doc_id`,
    ).all()) as (Omit<HitRow, 'score'> & { dimensions: number; vector: string })[]
    const semantic: RankedChunk[] = queryVector === undefined ? [] : vectors
      .map((row) => {
        const vector = parseVector(row.vector)
        if (vector.length !== row.dimensions) throw new Error('meteo-corpus: stored embedding dimensions do not match')
        return {
          ...toHit({ ...row, score: 0 }),
          key: `${row.doc_id}:${row.ordinal}`,
          score: cosineSimilarity(queryVector, vector),
        }
      })
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
      .slice(0, this.config.candidateLimit)
    const lexicalRanked = lexical.map((row, rank) => ({ ...toHit(row), key: `${row.doc_id}:${row.ordinal}`, score: rank }))
    return { hits: fuseRanks(lexicalRanked, semantic, limit), matchExpression }
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
    db.prepare('DELETE FROM chunk_vectors WHERE doc_id = ?').run(docId)
    db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId)
    const removed = db.prepare('DELETE FROM docs WHERE doc_id = ?').run(docId).changes > 0
    return { docId, removed }
  }
}

export default SqliteCorpusStore

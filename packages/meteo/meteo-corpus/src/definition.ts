/**
 * Service Definition for the corpus retrieval capability seam (`ctx.corpus`):
 * an abstract service defining WHAT a corpus does — take documents, index them,
 * and return the chunks that answer a question — without saying HOW.
 *
 * Implementations subclass {@link CorpusStore} and load as a plugin; the shipped
 * implementation is {@link SqliteCorpusStore} (`./sqlite.ts`), which indexes
 * CJK bigrams in an FTS5 table of its own database file.
 *
 * The seam owns no retrieval policy: it does not decide which documents are
 * ingestible, when a question deserves a search, or how many hits a consumer
 * should cite. Callers pass expansion terms; the backend returns scored chunks.
 *
 * @module @deepseek-ai/dsh-meteo-corpus
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CorpusChunk,
  CorpusDocument,
  CorpusDocumentId,
  IngestRequest,
  IngestResult,
  RemoveResult,
  SearchRequest,
  SearchResult,
} from './types.ts'

export type {
  CorpusChunk,
  CorpusDocument,
  CorpusDocumentId,
  CorpusHit,
  IngestFailure,
  IngestRequest,
  IngestResult,
  IngestSource,
  IngestTextSource,
  RemoveResult,
  SearchRequest,
  SearchResult,
} from './types.ts'
export { DEFAULT_CHUNK_CHARS, bigrams, chunkText, indexTokens } from './text.ts'
export { buildMatchExpression } from './match.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    corpus: CorpusStore
  }
}

/**
 * Abstract corpus store. Subclass, implement every method, and load the
 * subclass as a plugin — it registers as `ctx.corpus` (one implementation per
 * context; loading a second throws, cordis' standard duplicate-service
 * behavior).
 *
 * Semantics every implementation must honor:
 * - `ingest` indexes each accepted source independently: a source rejected for
 *   its own reason is reported in {@link IngestResult.failures} and never
 *   aborts the others.
 * - `search` is recall-oriented. An empty result is a legitimate answer and
 *   callers must tolerate it; the implementation must not substitute a
 *   fallback query the caller did not ask for.
 * - `readChunk` returns the stored chunk verbatim, so a citation rendered from
 *   it matches the source document's characters at `charStart`–`charEnd`.
 * - Every method rejects only on a real backend failure.
 */
export abstract class CorpusStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'corpus')
  }

  /**
   * Split, tokenize, and index each source.
   * @param request - the sources to ingest.
   * @returns the stored documents and the per-source failures.
   */
  abstract ingest(request: IngestRequest): Promise<IngestResult>

  /**
   * Retrieve the chunks that best match a question.
   * @param request - the question, its expansion terms, and an optional hit limit.
   * @returns ranked hits and the MATCH expression that produced them.
   */
  abstract search(request: SearchRequest): Promise<SearchResult>

  /**
   * Read one stored chunk verbatim.
   * @param docId - the document to read from.
   * @param ordinal - the chunk's position inside that document.
   * @returns the chunk, or `undefined` when the document or ordinal is unknown.
   */
  abstract readChunk(docId: CorpusDocumentId, ordinal: number): Promise<CorpusChunk | undefined>

  /**
   * List the indexed documents, newest first.
   * @param limit - optional cap on the number of documents returned.
   * @returns the document records without their chunk text.
   */
  abstract listDocuments(limit?: number): Promise<CorpusDocument[]>

  /**
   * Remove a document and its chunks.
   * @param docId - the document to remove.
   * @returns whether a document was actually removed.
   */
  abstract remove(docId: CorpusDocumentId): Promise<RemoveResult>
}

export default CorpusStore

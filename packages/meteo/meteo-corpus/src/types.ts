/**
 * Wire types for the corpus retrieval capability (`ctx.corpus`).
 *
 * A corpus is a durable, process-wide document index: uploaded documents are
 * split into chunks, each chunk is indexed under a CJK-aware token form, and
 * retrieval returns chunks with the character offsets a citation needs. The
 * seam owns no policy about WHAT is ingested or WHEN it is retrieved; the
 * meteorology tools decide both.
 *
 * @module @deepseek-ai/dsh-meteo-corpus/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one ingested document. */
export type CorpusDocumentId = Branded<'CorpusDocumentId'>

/** One text source handed to {@link CorpusStore.ingest}. */
export interface IngestTextSource {
  /** Human-facing document title, also the retrieval result's label. */
  readonly title: string
  /** Full document text; the chunker owns how it is split. */
  readonly text: string
  /** Where the text came from, shown with citations (a filename, an uploader note). */
  readonly source: string
}

/** A document to ingest. */
export type IngestSource = IngestTextSource

/** What an ingest call produced. */
export interface CorpusDocument {
  /** Index identity of the stored document. */
  readonly docId: CorpusDocumentId
  readonly title: string
  readonly source: string
  /** UTF-8 byte length of the accepted text. */
  readonly bytes: number
  /** Number of chunks written to the index. */
  readonly chunkCount: number
  /** Epoch milliseconds of the ingest. */
  readonly ingestedAt: number
}

/** One source that could not be ingested. */
export interface IngestFailure {
  readonly title: string
  /** Stable failure code; callers switch on it rather than on the message. */
  readonly code: 'CORPUS_EMPTY_DOCUMENT' | 'CORPUS_DOCUMENT_TOO_LARGE'
  readonly message: string
}

/** Request for {@link CorpusStore.ingest}. */
export interface IngestRequest {
  readonly sources: readonly IngestSource[]
}

/** Result of {@link CorpusStore.ingest}; a rejected source never aborts the others. */
export interface IngestResult {
  readonly documents: readonly CorpusDocument[]
  readonly failures: readonly IngestFailure[]
}

/** One addressable chunk of a stored document. */
export interface CorpusChunk {
  readonly docId: CorpusDocumentId
  /** Zero-based position of the chunk inside its document. */
  readonly ordinal: number
  /** Heading trail above the chunk, empty when the document has no headings. */
  readonly headingPath: string
  /** Character offset of the chunk's first character in the source document. */
  readonly charStart: number
  /** Character offset one past the chunk's last character. */
  readonly charEnd: number
  readonly text: string
}

/** A retrieved chunk with its ranking score and document title. */
export interface CorpusHit extends CorpusChunk {
  readonly docTitle: string
  /** SQLite FTS5 BM25 score; lower is a better match, matching FTS5's own convention. */
  readonly score: number
}

/** Request for {@link CorpusStore.search}. */
export interface SearchRequest {
  /** The user-facing question, used as-is for recall. */
  readonly query: string
  /**
   * Domain terms the caller derived from the question (disaster type, crop,
   * farming activity, weather element) plus their synonyms. Recall unions these
   * with the query's own tokens, which is what keeps a colloquial sentence from
   * returning nothing when one of its words is absent from the corpus.
   */
  readonly terms?: readonly string[]
  /** Number of hits to return. Defaults to the backend's configured default. */
  readonly limit?: number
}

/** Result of {@link CorpusStore.search}. */
export interface SearchResult {
  readonly hits: readonly CorpusHit[]
  /** The FTS5 MATCH expression actually issued; surfaced for diagnosis and tests. */
  readonly matchExpression: string
}

/** Result of {@link CorpusStore.remove}. */
export interface RemoveResult {
  readonly docId: CorpusDocumentId
  /** Whether a document was actually removed. */
  readonly removed: boolean
}

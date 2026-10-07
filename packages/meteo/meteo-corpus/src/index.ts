/**
 * `@deepseek-ai/dsh-meteo-corpus` — the corpus retrieval capability seam:
 * an abstract {@link CorpusStore} Service Definition and the shipped
 * {@link SqliteCorpusStore} provider.
 *
 * The package's default export is the provider, so a `cordis.yml` row names the
 * package directly. The Service Definition travels with it because a corpus has
 * exactly one durable-index shape here; an alternative backend (a remote
 * retrieval service, an embedding index) that evolves independently gets its own
 * package and registers against the same abstract class.
 *
 * Vector recall is an optional peer, never a load-time dependency: the provider
 * reads `ctx.textEmbeddings` at the point of use, so a composition that mounts
 * no embedding provider still boots, ingests, and answers lexically. Mount the
 * registry plus one provider to add the fused semantic path.
 *
 * @module @deepseek-ai/dsh-meteo-corpus
 */

export { CorpusStore } from './definition.ts'
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
export { fuseRanks, cosineSimilarity } from './fusion.ts'
export type { RankedChunk } from './fusion.ts'
export { DEFAULT_CHUNK_CHARS, bigrams, chunkText, indexTokens } from './text.ts'
export { buildMatchExpression } from './match.ts'
export {
  CORPUS_APPLICATION_ID,
  CORPUS_SCHEMA_VERSION,
  CORPUS_TABLES,
  openCorpusDatabase,
  resolveCorpusPath,
} from './schema.ts'
export type { CorpusJournalMode } from './schema.ts'
export { SqliteCorpusStore } from './sqlite.ts'
export type { Config } from './sqlite.ts'
export { SqliteCorpusStore as default } from './sqlite.ts'

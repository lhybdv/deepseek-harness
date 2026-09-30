/**
 * Host Remote owner of the meteorology consultation surface: the corpus panel's
 * reads and writes and the session focus, over the `ctx.corpus` and
 * `ctx.meteoData` seams.
 *
 * This package decides nothing about weather and stores nothing. It is the
 * browser-facing edge of two seams that already answer the model: a panel and a
 * tool read the same index, so a citation the user clicks is the citation the
 * model quoted.
 *
 * @module @deepseek-ai/dsh-api-meteo-controller
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MeteoDataError, readFocus } from '@deepseek-ai/dsh-meteo-data'
import type { StationQuery } from '@deepseek-ai/dsh-meteo-data'
import type { CorpusDocumentId, CorpusHit } from '@deepseek-ai/dsh-meteo-corpus'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  MeteoChunk,
  MeteoDocument,
  MeteoDocumentId,
  MeteoFocus,
  MeteoIngestSource,
  MeteoIngestValue,
  MeteoRemoveValue,
  MeteoSearchHit,
  MeteoSearchValue,
  MeteoStation,
} from './types.ts'

export type * from './types.ts'

/** Documents one `corpusList` call may ask the index for. */
const MAX_LIST_DOCS = 200

/** Documents one `corpusIngest` call may submit; one request never starts unbounded index work. */
const MAX_INGEST_SOURCES = 32

/** Characters of chunk text one search hit carries, enough for a panel row and its citation. */
const MAX_EXCERPT_CHARS = 240

const nonEmptyText = z.string().min(1)
const positiveCount = z.number().int().min(1)

const listRequestSchema = z.object({
  limit: positiveCount.max(MAX_LIST_DOCS).optional(),
})

const ingestRequestSchema = z.object({
  // The source label is optional material: the panel's source field is blank by
  // default, and the `corpus_ingest` tool submits `''` when the caller gives
  // none, so an empty label is accepted and carried through rather than refused.
  sources: z.array(z.object({ title: nonEmptyText, text: z.string(), source: z.string() }))
    .min(1)
    .max(MAX_INGEST_SOURCES),
})

const searchRequestSchema = z.object({
  query: nonEmptyText,
  terms: z.array(nonEmptyText).optional(),
  // No ceiling here: the store clamps an explicit limit to its own configured
  // maximum, and a second ceiling would silently contradict that configuration.
  limit: positiveCount.optional(),
})

const readChunkRequestSchema = z.object({ docId: nonEmptyText, ordinal: z.number().int().min(0) })

const removeRequestSchema = z.object({ docId: nonEmptyText })

const stationRequestSchema = z.object({
  text: nonEmptyText.optional(),
  county: nonEmptyText.optional(),
}).refine(query => query.text !== undefined || query.county !== undefined, {
  message: 'stationLookup needs a text or a county to filter by; with neither it would return every station',
})

/** Parse the domain constraints that are more specific than generated TypeScript codecs. */
function parseRequest<Value>(method: string, schema: z.ZodType<Value>, value: unknown): Value {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
  }
  return parsed.data
}

/**
 * Project one stored hit onto the panel's view of it: the citation fields, the
 * chunk text collapsed to one line and capped so a hit is a row rather than a
 * paragraph, and none of the chunk body — which `corpusRead` reopens.
 * @param hit - the hit the index returned.
 * @returns the fields a citation and a panel row need.
 */
function hitView(hit: CorpusHit): MeteoSearchHit {
  const { text, ...citation } = hit
  const flat = text.replace(/\s+/gu, ' ').trim()
  return { ...citation, excerpt: flat.length <= MAX_EXCERPT_CHARS ? flat : `${flat.slice(0, MAX_EXCERPT_CHARS)}…` }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `meteo` Remote namespace. */
    meteoController: MeteoController
  }
}

/**
 * Host service backing the generated `ctx.remote.meteo` namespace. Every method
 * delegates to the seam that owns the answer and carries only what a browser
 * call adds: the request bounds the wire codec cannot state, the view a panel
 * renders, and a named failure where a seam's silence would otherwise read as
 * success.
 */
export class MeteoController extends TypertRemoteService {
  static inject = ['corpus', 'meteoData', 'sessionProjections', 'typert']

  /**
   * Register the `meteo` namespace over the corpus and data seams.
   * @param ctx - Host context that composes both seams and the projection registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'meteoController', { namespace: 'meteo' })
  }

  /**
   * List the indexed documents, newest ingest first.
   * @param limit - documents to return, at most {@link MAX_LIST_DOCS}; `undefined` returns the whole index.
   * @returns one entry per stored document.
   * @throws RemoteError when `limit` is not a positive integer within the bound.
   */
  @Remote
  async corpusList(limit: number | undefined): Promise<MeteoDocument[]> {
    const request = parseRequest('meteo.corpusList', listRequestSchema, { limit })
    return this.ctx.corpus.listDocuments(request.limit)
  }

  /**
   * Index submitted documents.
   * @param sources - one to {@link MAX_INGEST_SOURCES} documents; a title must not be empty,
   *   while the source label may be. Empty or oversized text is the store's per-document
   *   failure, reported in the result rather than raised here, so one rejected document never
   *   aborts its siblings.
   * @returns the stored documents and the per-source refusals.
   * @throws RemoteError when the batch is empty, oversized, or a source has no title.
   */
  @Remote
  async corpusIngest(sources: readonly MeteoIngestSource[]): Promise<MeteoIngestValue> {
    const request = parseRequest('meteo.corpusIngest', ingestRequestSchema, { sources })
    return this.ctx.corpus.ingest({ sources: request.sources })
  }

  /**
   * Search the indexed documents for one question.
   * @param query - the question, used as-is for recall.
   * @param terms - domain terms derived from the question; recall unions them with its own tokens.
   * @param limit - hits wanted; the store clamps it to its own configured ceiling. `undefined` takes its default.
   * @returns the ranked hits with the citation fields and a capped excerpt, plus the match expression issued.
   * @throws RemoteError when the query or a term is empty, or `limit` is not a positive integer.
   */
  @Remote
  async corpusSearch(
    query: string,
    terms: readonly string[] | undefined,
    limit: number | undefined,
  ): Promise<MeteoSearchValue> {
    const request = parseRequest('meteo.corpusSearch', searchRequestSchema, { query, terms, limit })
    const result = await this.ctx.corpus.search({
      query: request.query,
      ...request.terms === undefined ? {} : { terms: request.terms },
      ...request.limit === undefined ? {} : { limit: request.limit },
    })
    return {
      hits: result.hits.map(hitView),
      matchExpression: result.matchExpression,
    }
  }

  /**
   * Reopen one stored chunk in full, which is what a panel does when a hit's
   * excerpt is not enough to read the passage it cites.
   * @param docId - indexed document to read from.
   * @param ordinal - zero-based chunk position inside that document.
   * @returns the stored chunk verbatim, with the character offsets of the source document.
   * @throws RemoteError when the address is malformed or the chunk is not in the index.
   */
  @Remote
  async corpusRead(docId: MeteoDocumentId, ordinal: number): Promise<MeteoChunk> {
    const request = parseRequest('meteo.corpusRead', readChunkRequestSchema, { docId, ordinal })
    const address = brandString<CorpusDocumentId>(request.docId)
    const chunk = await this.ctx.corpus.readChunk(address, request.ordinal)
    if (chunk === undefined) {
      throw new RemoteError(
        'meteo/chunk-not-found',
        `document "${request.docId}" has no chunk ${String(request.ordinal)}`,
        { docId: address, ordinal: request.ordinal },
      )
    }
    return chunk
  }

  /**
   * Withdraw one document from the index.
   * @param docId - document to remove.
   * @returns the removal outcome; `removed: false` is an answer, not a failure — the document
   *   was already gone, which is the state the panel wanted.
   * @throws RemoteError when the document id is empty.
   */
  @Remote
  async corpusRemove(docId: MeteoDocumentId): Promise<MeteoRemoveValue> {
    const request = parseRequest('meteo.corpusRemove', removeRequestSchema, { docId })
    return this.ctx.corpus.remove(brandString<CorpusDocumentId>(request.docId))
  }

  /**
   * Read the place and crop this session's consultation is working on, which is
   * how a panel shows what the model currently believes it is answering about.
   * @param agent - target Agent resolved from the Session identity on the wire.
   * @returns the focus this session last wrote, or `null` when it has none.
   */
  @Remote
  focusGet(agent: Agent): MeteoFocus | null {
    return readFocus(this.ctx, agent)
  }

  /**
   * Look stations up by name, township, or county.
   * @param text - substring matched against station name, township and county.
   * @param county - keep only stations of this county-level division.
   * @returns the matching stations, in dataset order.
   * @throws RemoteError when neither filter is given, or the data seam cannot answer.
   */
  @Remote
  async stationLookup(text: string | undefined, county: string | undefined): Promise<readonly MeteoStation[]> {
    const filters = parseRequest('meteo.stationLookup', stationRequestSchema, { text, county })
    const query: StationQuery = {
      ...filters.text === undefined ? {} : { text: filters.text },
      ...filters.county === undefined ? {} : { county: filters.county },
    }
    try {
      return await this.ctx.meteoData.stations(query)
    } catch (error: unknown) {
      if (error instanceof MeteoDataError) {
        throw new RemoteError(
          'meteo/data-unavailable',
          `station lookup failed: ${error.message}`,
          { reason: error.code },
          { cause: error },
        )
      }
      throw error
    }
  }
}

export default MeteoController

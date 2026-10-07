/**
 * Behaviour tests for the `meteo` Remote namespace as the consultation panel
 * sees it: the seam request each call issues, the view each answer carries, the
 * request bounds a wire codec cannot state, and the named failures this
 * namespace raises in its own name.
 *
 * Both seams are stub subclasses that record what they were asked for, so a case
 * fails when the controller changes what crosses the seam rather than when a
 * backend changes how it ranks or filters.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MeteoData, MeteoDataError, appendFocus, meteoFocusProjectionDefinition } from '@deepseek-ai/dsh-meteo-data'
import type {
  CropWindow, DatasetVersions, ForecastPoint, Observation, Station, StationQuery, Threshold,
} from '@deepseek-ai/dsh-meteo-data'
import { CorpusStore } from '@deepseek-ai/dsh-meteo-corpus'
import type {
  CorpusChunk, CorpusDocument, CorpusDocumentId, CorpusHit,
  IngestRequest, IngestResult, RemoveResult, SearchRequest, SearchResult,
} from '@deepseek-ai/dsh-meteo-corpus'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import MeteoController from '../src/index.ts'

const DOC_ID = brandString<CorpusDocumentId>('doc-1')

const DOCUMENT: CorpusDocument = {
  docId: DOC_ID,
  title: '病虫害防治气象指标',
  source: 'guides/spray.md',
  bytes: 4200,
  chunkCount: 2,
  ingestedAt: 1_759_000_000_000,
}

const CHUNK: CorpusChunk = {
  docId: DOC_ID,
  ordinal: 1,
  headingPath: '施药适宜气象条件',
  charStart: 120,
  charEnd: 520,
  text: '风速低于 3 米每秒，相对湿度 40% 至 70%，未来 6 小时无降水。',
}

const STATION: Station = {
  id: 'p01',
  name: '顺义国家基本气象站',
  county: '顺义区',
  township: '仁和镇',
  lon: 116.65,
  lat: 40.13,
  altitudeM: 34.6,
}

/** One hit whose text is short enough to travel as its own excerpt. */
const SHORT_HIT: CorpusHit = { ...CHUNK, docTitle: DOCUMENT.title, score: 1.9, text: '适宜窗口。\n  风速低于 3 米每秒。' }

/** One hit long enough that the excerpt has to be cut rather than carried. */
const LONG_HIT: CorpusHit = {
  ...CHUNK,
  docTitle: DOCUMENT.title,
  score: 3.4,
  text: `head ${'x'.repeat(300)} tail-marker`,
}

/** The failure a data seam raises when its dataset cannot be read at all. */
const UNAVAILABLE = new MeteoDataError('METEO_DATASET_UNAVAILABLE', 'station dataset is not deployed')

/** A stub seam member the `meteo` namespace never calls. */
function notReached(member: string): Error {
  return new Error(`StubMeteoData.${member} is outside the meteo namespace, which reads stations only`)
}

/** `ctx.corpus` for these cases: every seam call recorded, every answer settable. */
class StubCorpus extends CorpusStore {
  readonly ingestRequests: IngestRequest[] = []
  readonly searchRequests: SearchRequest[] = []
  readonly readRequests: { docId: CorpusDocumentId; ordinal: number }[] = []
  readonly listLimits: (number | undefined)[] = []
  readonly removeRequests: CorpusDocumentId[] = []
  ingestOutcome: IngestResult = { documents: [], failures: [] }
  searchResult: SearchResult = { hits: [SHORT_HIT], matchExpression: '"打药" OR "施药"' }
  documents: CorpusDocument[] = [DOCUMENT]
  chunk: CorpusChunk | undefined = CHUNK
  removeOutcome: RemoveResult = { docId: DOC_ID, removed: true }

  async ingest(request: IngestRequest): Promise<IngestResult> {
    this.ingestRequests.push(request)
    return this.ingestOutcome
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    this.searchRequests.push(request)
    return this.searchResult
  }

  async readChunk(docId: CorpusDocumentId, ordinal: number): Promise<CorpusChunk | undefined> {
    this.readRequests.push({ docId, ordinal })
    return this.chunk
  }

  async listDocuments(limit?: number): Promise<CorpusDocument[]> {
    this.listLimits.push(limit)
    return this.documents
  }

  async remove(docId: CorpusDocumentId): Promise<RemoveResult> {
    this.removeRequests.push(docId)
    return this.removeOutcome
  }
}

/** `ctx.meteoData` for these cases: the station query recorded, the answer settable. */
class StubMeteoData extends MeteoData {
  readonly stationQueries: (StationQuery | undefined)[] = []
  stationsOutcome: readonly Station[] = [STATION]
  stationsFailure: Error | undefined = undefined

  /**
   * Mount the stub and honour the registration contract the real provider takes
   * on when it loads, so `focusGet` has a projection to read.
   * @param ctx - context under test.
   */
  constructor(ctx: Context) {
    super(ctx)
    ctx.inject(['sessionProjections'], (scope) => {
      scope.effect(
        () => scope.sessionProjections.register(meteoFocusProjectionDefinition),
        'stubMeteoData.focusProjection()',
      )
    })
  }

  async stations(query?: StationQuery): Promise<readonly Station[]> {
    this.stationQueries.push(query)
    if (this.stationsFailure !== undefined) throw this.stationsFailure
    return this.stationsOutcome
  }

  async station(): Promise<Station | undefined> {
    throw notReached('station')
  }

  async observations(): Promise<readonly Observation[]> {
    throw notReached('observations')
  }

  async forecast(): Promise<readonly ForecastPoint[]> {
    throw notReached('forecast')
  }

  async thresholds(): Promise<readonly Threshold[]> {
    throw notReached('thresholds')
  }

  async cropCalendar(): Promise<readonly CropWindow[]> {
    throw notReached('cropCalendar')
  }

  async expandTerm(): Promise<readonly string[]> {
    throw notReached('expandTerm')
  }

  async versions(): Promise<DatasetVersions> {
    throw notReached('versions')
  }
}

const contexts: Context[] = []
let created = 0

/** A live context whose corpus, data seam, session log, and projection registry are the stubs above. */
async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(StubCorpus)
  await ctx.plugin(StubMeteoData)
  created += 1
  const session = ctx.sessions.create(SessionId(`meteo-controller-${String(created)}`))
  return {
    controller: new MeteoController(ctx),
    corpus: ctx.corpus as StubCorpus,
    data: ctx.meteoData as StubMeteoData,
    agent: { session } as unknown as Agent,
    session,
  }
}

/** Run a call that must fail and hand back the failure the wire carrier would deliver. */
async function remoteFailure(run: () => Promise<unknown>): Promise<RemoteFailure | undefined> {
  const caught = await run().catch((error: unknown) => error)
  return remoteErrorOf(caught)
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('meteo namespace binding', () => {
  it('publishes the consultation methods under one namespace', async () => {
    const { controller } = await harness()
    expect(controller.typertRemote.serviceKey).toBe('meteoController')
    expect(controller.typertRemote.namespace).toBe('meteo')
    expect(remoteMethods(controller).map(marker => marker.method).sort()).toEqual([
      'corpusIngest',
      'corpusList',
      'corpusRead',
      'corpusRemove',
      'corpusSearch',
      'focusGet',
      'stationLookup',
    ])
  })
})

describe('corpusList', () => {
  it('asks the index for a page and hands back its documents unchanged', async () => {
    const { controller, corpus } = await harness()
    await expect(controller.corpusList(20)).resolves.toEqual([DOCUMENT])
    expect(corpus.listLimits).toEqual([20])
  })

  it('lets the index list the whole catalog when no limit is given', async () => {
    const { controller, corpus } = await harness()
    await expect(controller.corpusList(undefined)).resolves.toEqual([DOCUMENT])
    expect(corpus.listLimits).toEqual([undefined])
  })

  it('refuses a limit that is not a whole number of documents within the bound', async () => {
    const { controller, corpus } = await harness()
    for (const limit of [0, -3, 1.5, 201]) {
      expect(await remoteFailure(() => controller.corpusList(limit))).toMatchObject({ code: 'gateway/bad-request' })
    }
    expect(corpus.listLimits).toEqual([])
  })
})

describe('corpusIngest', () => {
  it('hands the index the submitted documents and reports what it accepted and refused', async () => {
    const { controller, corpus } = await harness()
    corpus.ingestOutcome = {
      documents: [DOCUMENT],
      failures: [{ title: '空文档', code: 'CORPUS_EMPTY_DOCUMENT', message: 'document text is empty' }],
    }
    await expect(controller.corpusIngest([
      { title: DOCUMENT.title, text: '风速低于 3 米每秒', source: DOCUMENT.source },
    ])).resolves.toEqual(corpus.ingestOutcome)
    expect(corpus.ingestRequests).toEqual([{
      sources: [{ title: DOCUMENT.title, text: '风速低于 3 米每秒', source: DOCUMENT.source }],
    }])
  })

  it('carries empty document text to the index, whose refusal is data rather than a failed call', async () => {
    const { controller, corpus } = await harness()
    corpus.ingestOutcome = {
      documents: [],
      failures: [{ title: DOCUMENT.title, code: 'CORPUS_EMPTY_DOCUMENT', message: 'document text is empty' }],
    }
    const result = await controller.corpusIngest([{ title: DOCUMENT.title, text: '', source: DOCUMENT.source }])
    expect(result.failures.map(failure => failure.code)).toEqual(['CORPUS_EMPTY_DOCUMENT'])
    expect(corpus.ingestRequests[0]?.sources[0]?.text).toBe('')
  })

  it('drops the fields the index has no column for', async () => {
    const { controller, corpus } = await harness()
    const submitted = { title: DOCUMENT.title, text: 'text', source: DOCUMENT.source, owner: 'ui' }
    await controller.corpusIngest([submitted])
    expect(corpus.ingestRequests[0]?.sources[0]).toEqual({
      title: DOCUMENT.title, text: 'text', source: DOCUMENT.source,
    })
  })

  it('carries an empty source label to the index, which the panel and the tool both submit', async () => {
    const { controller, corpus } = await harness()
    await controller.corpusIngest([{ title: DOCUMENT.title, text: 'text', source: '' }])
    expect(corpus.ingestRequests[0]?.sources[0]).toEqual({
      title: DOCUMENT.title, text: 'text', source: '',
    })
  })

  it('refuses a batch that is empty, oversized, or missing a title', async () => {
    const { controller, corpus } = await harness()
    const source = { title: DOCUMENT.title, text: 'text', source: DOCUMENT.source }
    expect(await remoteFailure(() => controller.corpusIngest([]))).toMatchObject({ code: 'gateway/bad-request' })
    expect(await remoteFailure(() => controller.corpusIngest(Array.from({ length: 33 }, () => source))))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(await remoteFailure(() => controller.corpusIngest([{ ...source, title: '' }])))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(corpus.ingestRequests).toEqual([])
  })
})

describe('corpusSearch', () => {
  it('returns each hit with its citation fields and a one-line excerpt, and never the chunk body', async () => {
    const { controller } = await harness()
    await expect(controller.corpusSearch('什么时候能打药', ['施药'], 5)).resolves.toEqual({
      hits: [{
        docId: DOC_ID,
        docTitle: DOCUMENT.title,
        ordinal: CHUNK.ordinal,
        headingPath: CHUNK.headingPath,
        charStart: CHUNK.charStart,
        charEnd: CHUNK.charEnd,
        score: SHORT_HIT.score,
        excerpt: '适宜窗口。 风速低于 3 米每秒。',
      }],
      matchExpression: '"打药" OR "施药"',
    })
  })

  it('cuts a long chunk to one capped excerpt instead of carrying the document', async () => {
    const { controller, corpus } = await harness()
    corpus.searchResult = { hits: [LONG_HIT], matchExpression: '"head"' }
    const [hit] = (await controller.corpusSearch('head', undefined, undefined)).hits
    expect(hit?.excerpt).toHaveLength(241)
    expect(hit?.excerpt.startsWith('head ')).toBe(true)
    expect(hit?.excerpt).not.toContain('tail-marker')
  })

  it('forwards only the narrowing the panel actually chose', async () => {
    const { controller, corpus } = await harness()
    await controller.corpusSearch('什么时候能打药', undefined, undefined)
    expect(corpus.searchRequests).toEqual([{ query: '什么时候能打药' }])
  })

  it('forwards derived terms and a requested hit count', async () => {
    const { controller, corpus } = await harness()
    await controller.corpusSearch('什么时候能打药', ['施药', '风速'], 3)
    expect(corpus.searchRequests[0]).toEqual({ query: '什么时候能打药', terms: ['施药', '风速'], limit: 3 })
  })

  it('refuses an empty question, an empty term, or a limit below one document', async () => {
    const { controller, corpus } = await harness()
    expect(await remoteFailure(() => controller.corpusSearch('', ['施药'], undefined)))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(await remoteFailure(() => controller.corpusSearch('打药', [''], undefined)))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(await remoteFailure(() => controller.corpusSearch('打药', undefined, 0)))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(corpus.searchRequests).toEqual([])
  })
})

describe('corpusRead', () => {
  it('reopens the stored chunk verbatim', async () => {
    const { controller, corpus } = await harness()
    await expect(controller.corpusRead(DOC_ID, 1)).resolves.toBe(CHUNK)
    expect(corpus.readRequests).toEqual([{ docId: DOC_ID, ordinal: 1 }])
  })

  it('names the address it asked for when the index holds no such chunk', async () => {
    const { controller, corpus } = await harness()
    corpus.chunk = undefined
    expect(await remoteFailure(() => controller.corpusRead(DOC_ID, 7))).toMatchObject({
      code: 'meteo/chunk-not-found',
      details: { docId: DOC_ID, ordinal: 7 },
    })
  })

  it('refuses an address the index cannot hold', async () => {
    const { controller, corpus } = await harness()
    expect(await remoteFailure(() => controller.corpusRead(brandString<CorpusDocumentId>(''), 0)))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(await remoteFailure(() => controller.corpusRead(DOC_ID, -1)))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(await remoteFailure(() => controller.corpusRead(DOC_ID, 0.5)))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(corpus.readRequests).toEqual([])
  })
})

describe('corpusRemove', () => {
  it('reports the outcome the index gave, including a document that was already gone', async () => {
    const { controller, corpus } = await harness()
    corpus.removeOutcome = { docId: DOC_ID, removed: false }
    await expect(controller.corpusRemove(DOC_ID)).resolves.toEqual({ docId: DOC_ID, removed: false })
    expect(corpus.removeRequests).toEqual([DOC_ID])
  })

  it('refuses an empty document id', async () => {
    const { controller, corpus } = await harness()
    expect(await remoteFailure(() => controller.corpusRemove(brandString<CorpusDocumentId>(''))))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(corpus.removeRequests).toEqual([])
  })
})

describe('focusGet', () => {
  it('answers null for a session that has settled no place', async () => {
    const { controller, agent } = await harness()
    expect(controller.focusGet(agent)).toBeNull()
  })

  it('answers with the focus this session last wrote', async () => {
    const { controller, agent, session } = await harness()
    appendFocus(session, { stationId: STATION.id, crop: '玉米', updatedAt: 1_759_000_000_000 })
    expect(controller.focusGet(agent)).toEqual({ stationId: STATION.id, crop: '玉米', updatedAt: 1_759_000_000_000 })
    appendFocus(session, { crop: '大豆', updatedAt: 1_759_003_600_000 })
    expect(controller.focusGet(agent)).toEqual({ crop: '大豆', updatedAt: 1_759_003_600_000 })
  })
})

describe('stationLookup', () => {
  it('forwards the free-text filter as the query the data seam takes', async () => {
    const { controller, data } = await harness()
    await expect(controller.stationLookup('顺义', undefined)).resolves.toBe(data.stationsOutcome)
    expect(data.stationQueries).toEqual([{ text: '顺义' }])
  })

  it('forwards the county filter alone when the panel picked a division', async () => {
    const { controller, data } = await harness()
    await controller.stationLookup(undefined, '顺义区')
    expect(data.stationQueries).toEqual([{ county: '顺义区' }])
  })

  it('forwards both filters together', async () => {
    const { controller, data } = await harness()
    await controller.stationLookup('顺义', '顺义区')
    expect(data.stationQueries).toEqual([{ text: '顺义', county: '顺义区' }])
  })

  it('refuses a lookup that would answer with every station in the country', async () => {
    const { controller, data } = await harness()
    expect(await remoteFailure(() => controller.stationLookup(undefined, undefined)))
      .toMatchObject({ code: 'gateway/bad-request' })
    expect(data.stationQueries).toEqual([])
  })

  it('reports the seam\'s own reason when the dataset cannot answer', async () => {
    const { controller, data } = await harness()
    data.stationsFailure = UNAVAILABLE
    const failure = await remoteFailure(() => controller.stationLookup('顺义', undefined))
    expect(failure).toMatchObject({ code: 'meteo/data-unavailable', details: { reason: 'METEO_DATASET_UNAVAILABLE' } })
    expect(failure?.cause).toBe(UNAVAILABLE)
  })

  it('passes a failure the seam did not classify through untouched', async () => {
    const { controller, data } = await harness()
    const unexpected = new Error('wired wrong')
    data.stationsFailure = unexpected
    const caught = await controller.stationLookup('顺义', undefined).catch((error: unknown) => error)
    expect(caught).toBe(unexpected)
    expect(remoteErrorOf(caught)).toBeUndefined()
  })
})

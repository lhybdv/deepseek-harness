/**
 * Tests for the SQLite corpus provider: the seam contract, configuration
 * validation, ingest outcomes, retrieval, and handle release.
 *
 * The retrieval cases pin the defect class that motivates the OR expression in
 * `match.ts`: a colloquial question carries words no professional corpus
 * contains, so an AND-joined query returns nothing at all. The regression case
 * asserts the colloquial form still reaches the document an operator would call
 * the right answer.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  CorpusStore,
  SqliteCorpusStore,
  type Config,
  type CorpusChunk,
  type CorpusDocument,
  type CorpusDocumentId,
  type IngestRequest,
  type IngestResult,
  type RemoveResult,
  type SearchRequest,
  type SearchResult,
} from '@deepseek-ai/dsh-meteo-corpus'

/** Minimal concrete backend, used only to pin the Service Definition contract. */
class StubStore extends CorpusStore {
  async ingest(request: IngestRequest): Promise<IngestResult> {
    void request
    return { documents: [], failures: [] }
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    return { hits: [], matchExpression: request.query }
  }

  async readChunk(docId: CorpusDocumentId, ordinal: number): Promise<CorpusChunk | undefined> {
    void docId
    void ordinal
    return undefined
  }

  async listDocuments(): Promise<CorpusDocument[]> {
    return []
  }

  async remove(docId: CorpusDocumentId): Promise<RemoveResult> {
    return { docId, removed: false }
  }
}

const SPRAY_DOC = [
  '# 病虫害防治气象指标',
  '## 施药适宜气象条件',
  '农作物施药作业要求风速低于 3 米每秒，气温宜在 15 至 28 摄氏度之间，降水前后 6 小时内不宜施药。',
].join('\n')

const DROUGHT_DOC = [
  '# 农业干旱与灌溉建议',
  '## 干旱等级',
  '连续无有效降水 21 至 30 天为中度干旱，土壤相对湿度低于 60% 时应及时灌溉。',
].join('\n')

let root: string
let opened: SqliteCorpusStore[]

function configuration(path: string, overrides: Partial<Config> = {}): Config {
  return {
    path,
    journalMode: 'delete',
    defaultLimit: 8,
    maxLimit: 50,
    maxMatchTokens: 64,
    maxChunkChars: 800,
    maxDocumentBytes: 4_000_000,
    ...overrides,
  }
}

/** Build a store in its own context and index file, tracked for teardown. */
function openStore(name: string, overrides: Partial<Config> = {}): SqliteCorpusStore {
  const store = new SqliteCorpusStore(new Context(), configuration(join(root, `${name}.sqlite`), overrides))
  opened.push(store)
  return store
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'meteo-corpus-'))
  opened = []
})

afterEach(async () => {
  await Promise.all(opened.map(store => store.close()))
  await rm(root, { recursive: true, force: true })
})

describe('CorpusStore seam', () => {
  it('registers the concrete backend as ctx.corpus', async () => {
    const ctx = new Context()
    await ctx.plugin(SqliteCorpusStore, configuration(join(root, 'plugin.sqlite')))
    expect(ctx.corpus).toBeInstanceOf(SqliteCorpusStore)
    opened.push(ctx.corpus as SqliteCorpusStore)
    await ctx.corpus.remove(brandString<CorpusDocumentId>('absent'))
  })

  it('rejects a second backend in the same context', () => {
    const ctx = new Context()
    opened.push(new SqliteCorpusStore(ctx, configuration(join(root, 'first.sqlite'))))
    expect(() => new SqliteCorpusStore(ctx, configuration(join(root, 'second.sqlite')))).toThrow()
  })

  it('exposes the stub contract without touching a database', async () => {
    const stub = new StubStore(new Context())
    await expect(stub.ingest({ sources: [] })).resolves.toEqual({ documents: [], failures: [] })
    await expect(stub.search({ query: 'x' })).resolves.toEqual({ hits: [], matchExpression: 'x' })
    await expect(stub.readChunk(brandString<CorpusDocumentId>('d'), 0)).resolves.toBeUndefined()
    await expect(stub.listDocuments()).resolves.toEqual([])
    await expect(stub.remove(brandString<CorpusDocumentId>('d'))).resolves.toEqual({ docId: 'd', removed: false })
  })
})

describe('configuration', () => {
  it('refuses a non-positive or fractional bound', () => {
    expect(() => new SqliteCorpusStore(new Context(), configuration(':memory:', { maxLimit: 0 }))).toThrow(
      /maxLimit must be a positive integer/,
    )
    expect(() => new SqliteCorpusStore(new Context(), configuration(':memory:', { defaultLimit: 1.5 }))).toThrow(
      /defaultLimit must be a positive integer/,
    )
  })

  it('refuses a default above the ceiling', () => {
    expect(
      () => new SqliteCorpusStore(new Context(), configuration(':memory:', { defaultLimit: 10, maxLimit: 5 })),
    ).toThrow(/defaultLimit must not exceed maxLimit/)
  })
})

describe('lifecycle', () => {
  it('releases the index handle and refuses work afterwards', async () => {
    const store = openStore('lifecycle')
    await store.ingest({ sources: [{ title: '甲', text: SPRAY_DOC, source: 'a.md' }] })
    await store.close()
    await store.close()
    await expect(store.listDocuments()).rejects.toThrow(/the corpus index is closed/)
  })

  it('closes cleanly before any index was opened', async () => {
    await expect(openStore('untouched').close()).resolves.toBeUndefined()
  })

  it('releases the handle when the owning plugin is disposed', async () => {
    const ctx = new Context()
    const path = join(root, 'disposed.sqlite')
    const fiber = await ctx.plugin(SqliteCorpusStore, configuration(path))
    await ctx.corpus.listDocuments()
    await fiber.dispose()
    expect((ctx as Context & { corpus?: unknown }).corpus).toBeUndefined()
    // Windows refuses to unlink a file an open handle still holds, so removing
    // the index here is what proves disposal released it rather than merely
    // dropping the service from the context.
    await expect(rm(path)).resolves.toBeUndefined()
  })

  it('closes cleanly when the index could never be opened', async () => {
    const blocked = join(root, 'blocked.sqlite')
    await mkdir(blocked)
    const store = openStore('never')
    await rm(join(root, 'never.sqlite'), { force: true })
    const failing = new SqliteCorpusStore(new Context(), configuration(blocked))
    opened.push(failing)
    await expect(failing.listDocuments()).rejects.toThrow()
    await expect(failing.close()).resolves.toBeUndefined()
    await expect(store.close()).resolves.toBeUndefined()
  })
})

describe('ingest', () => {
  it('stores a document and reports its chunk count', async () => {
    const store = openStore('ingest')
    const result = await store.ingest({ sources: [{ title: '施药指标', text: SPRAY_DOC, source: 'a.md' }] })
    expect(result.failures).toEqual([])
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]).toMatchObject({ title: '施药指标', source: 'a.md', chunkCount: 1 })
    expect(result.documents[0]?.bytes).toBe(Buffer.byteLength(SPRAY_DOC, 'utf8'))
    await expect(store.listDocuments()).resolves.toHaveLength(1)
  })

  it('reports a blank source without aborting the others', async () => {
    const store = openStore('blank')
    const result = await store.ingest({
      sources: [
        { title: '空的', text: '   \n ', source: 'empty.md' },
        { title: '施药指标', text: SPRAY_DOC, source: 'a.md' },
      ],
    })
    expect(result.documents.map(document => document.title)).toEqual(['施药指标'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ title: '空的', code: 'CORPUS_EMPTY_DOCUMENT' })
    expect(result.failures[0]?.message).toContain('empty')
  })

  it('reports an oversized source without aborting the others', async () => {
    const store = openStore('oversized', { maxDocumentBytes: 20 })
    const result = await store.ingest({
      sources: [
        { title: '太大的', text: '甲'.repeat(100), source: 'big.md' },
        { title: '小的', text: '甲。', source: 'small.md' },
      ],
    })
    expect(result.documents.map(document => document.title)).toEqual(['小的'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ title: '太大的', code: 'CORPUS_DOCUMENT_TOO_LARGE' })
    expect(result.failures[0]?.message).toContain('above the configured limit')
  })
})

describe('search', () => {
  /** Both fixture documents, ingested into a fresh index. */
  async function seeded(name: string, overrides: Partial<Config> = {}): Promise<SqliteCorpusStore> {
    const store = openStore(name, overrides)
    await store.ingest({
      sources: [
        { title: '病虫害防治气象指标', text: SPRAY_DOC, source: 'spray.md' },
        { title: '农业干旱与灌溉建议', text: DROUGHT_DOC, source: 'drought.md' },
      ],
    })
    return store
  }

  it('reaches the right document from a colloquial question', async () => {
    const store = await seeded('recall')
    const result = await store.search({ query: '明天下午在临河镇打药行不行', terms: ['打药', '施药', '喷药'] })
    expect(result.hits.length).toBeGreaterThan(0)
    expect(new Set(result.hits.map(hit => hit.docTitle))).toEqual(new Set(['病虫害防治气象指标']))
    expect(result.matchExpression).toContain('OR')
  })

  it('returns an empty result rather than a fallback when nothing tokenizes', async () => {
    const store = await seeded('empty')
    const result = await store.search({ query: '？？？' })
    expect(result.hits).toEqual([])
    expect(result.matchExpression).toBe('')
  })

  it('keeps a chunk verbatim with the offsets a citation needs', async () => {
    const store = await seeded('offsets')
    const result = await store.search({ query: '施药', limit: 1 })
    const hit = result.hits[0]
    expect(hit).toBeDefined()
    expect(SPRAY_DOC.slice(hit?.charStart, hit?.charEnd)).toBe(hit?.text)
    expect(hit?.headingPath).toBe('病虫害防治气象指标 > 施药适宜气象条件')
  })

  it('applies the configured default limit', async () => {
    const store = await seeded('default-limit', { defaultLimit: 1 })
    const result = await store.search({ query: '施药', terms: ['灌溉', '干旱'] })
    expect(result.hits).toHaveLength(1)
  })

  it('clamps an explicit limit to the configured ceiling and floor', async () => {
    const store = await seeded('ceiling', { maxLimit: 1, defaultLimit: 1 })
    const ceiling = await store.search({ query: '施药', terms: ['灌溉', '干旱'], limit: 99 })
    expect(ceiling.hits).toHaveLength(1)
    const floor = await store.search({ query: '施药', terms: ['灌溉', '干旱'], limit: 0 })
    expect(floor.hits).toHaveLength(1)
  })
})

describe('readChunk', () => {
  it('returns a stored chunk and reports an unknown ordinal', async () => {
    const store = openStore('read')
    const ingested = await store.ingest({ sources: [{ title: '施药指标', text: SPRAY_DOC, source: 'a.md' }] })
    const docId = ingested.documents[0]?.docId as CorpusDocumentId
    const chunk = await store.readChunk(docId, 0)
    expect(chunk?.text).toBe(
      '农作物施药作业要求风速低于 3 米每秒，气温宜在 15 至 28 摄氏度之间，降水前后 6 小时内不宜施药。',
    )
    await expect(store.readChunk(docId, 99)).resolves.toBeUndefined()
  })
})

describe('listDocuments', () => {
  it('honours a limit and floors it at one', async () => {
    const store = openStore('list')
    await store.ingest({
      sources: [
        { title: '甲', text: SPRAY_DOC, source: 'a.md' },
        { title: '乙', text: DROUGHT_DOC, source: 'b.md' },
      ],
    })
    await expect(store.listDocuments(1)).resolves.toHaveLength(1)
    await expect(store.listDocuments(0)).resolves.toHaveLength(1)
    await expect(store.listDocuments()).resolves.toHaveLength(2)
  })
})

describe('remove', () => {
  it('removes a document with its chunks and reports a missing one', async () => {
    const store = openStore('remove')
    const ingested = await store.ingest({ sources: [{ title: '施药指标', text: SPRAY_DOC, source: 'a.md' }] })
    const docId = ingested.documents[0]?.docId as CorpusDocumentId
    await expect(store.remove(docId)).resolves.toEqual({ docId, removed: true })
    await expect(store.listDocuments()).resolves.toEqual([])
    await expect(store.readChunk(docId, 0)).resolves.toBeUndefined()
    await expect(store.search({ query: '施药' })).resolves.toMatchObject({ hits: [] })
    await expect(store.remove(docId)).resolves.toEqual({ docId, removed: false })
  })
})

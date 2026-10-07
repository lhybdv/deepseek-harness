/** Fixture-backed data filling, citation coordinates, failures, and session idempotency. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalMeteoData } from '@deepseek-ai/dsh-meteo-data'
import { SqliteCorpusStore } from '@deepseek-ai/dsh-meteo-corpus'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config as CorpusConfig } from '@deepseek-ai/dsh-meteo-corpus'
import { resolve } from '../src/config.ts'
import { apply as applyProductPlugin } from '../src/plugin.ts'
import { generateFromResolvedHazard, generateProduct } from '../src/generate.ts'
import type { ProductComposer } from '../src/generate.ts'
import type { DocumentProductService as ProductService } from '../src/plugin.ts'
import type { DocumentProduct } from '../src/product.ts'
const fixtureDir = fileURLToPath(new URL('../../meteo-data/fixtures/', import.meta.url))
const grading = { stationId: 'hl-wc-01', from: '2026-09-23T00:00:00Z', to: '2026-09-23T23:00:00Z', hazard: '初霜', grade: 'high' }
let root = ''
let context: Context | undefined
let corpus: SqliteCorpusStore | undefined
let service: ProductService | undefined
async function setup(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'meteo-document-products-'))
  context = new Context()
  context.provide('textEmbeddings', {
    resolve: ({ texts, kind }: { texts: readonly string[]; kind: 'documents' | 'queries' }) => ({ texts, kind, provider: 'fixture-test' }),
    embed: async ({ texts }: { texts: readonly string[] }) => texts.map(text => [text.length, 1]),
  } as never)
  new LocalMeteoData(context, { source: 'fixture', fixtureDir, timeoutMs: 15_000 })
  const config: CorpusConfig = { path: join(root, 'corpus.sqlite'), journalMode: 'delete', defaultLimit: 8, maxLimit: 50, maxMatchTokens: 64, maxChunkChars: 800, maxDocumentBytes: 4_000_000, embeddingBatchSize: 32, candidateLimit: 100 }
  corpus = new SqliteCorpusStore(context, config)
  await corpus.ingest({ sources: [{ title: '东北玉米初霜防御指南', source: 'fixture-guide', text: '初霜临近玉米成熟收获期时应关注气温阈值和农事窗口，及时组织抢收并做好粮食晾晒。' }] })
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  applyProductPlugin(context, resolve({ forecastHours: 72, citationLimit: 5, timeoutMs: 30_000, snippetChars: 200 }))
  service = context.documentProducts
}
afterEach(async () => {
  await corpus?.close()
  if (root) await rm(root, { recursive: true, force: true })
  service = undefined
  corpus = undefined
  context = undefined
  root = ''
})
it('rejects invalid deployment limits during Cordis registration', () => {
  expect(() => applyProductPlugin(new Context(), { forecastHours: 0, citationLimit: 5 })).toThrow(/forecastHours/)
})
describe('document generation from bench fixtures', () => {
  it('fills disaster and crop templates with real fixture values and chunk coordinates', async () => {
    await setup()
    const activeContext = context
    if (activeContext === undefined) throw new Error('Generation test setup did not create a context')
    const data = activeContext.meteoData
    const store = activeContext.corpus
    const product = await generateProduct(data, store, { kind: '灾害预警产品', ...grading, forecastHours: 72, citationLimit: 5 })
    expect(product.body).toContain('初霜')
    expect(product.body).toContain('农事窗口')
    expect(product.provenance.some(value => value.source.startsWith('observation:'))).toBe(true)
    expect(product.provenance.some(value => value.source.startsWith('forecast:'))).toBe(true)
    expect(product.provenance.some(value => value.source.startsWith('threshold:'))).toBe(true)
    expect(product.provenance.some(value => value.source.startsWith('cropCalendar:'))).toBe(true)
    expect(product.citations.length).toBeGreaterThan(0)
    expect(product.citations[0]).toMatchObject({
      documentId: expect.any(String),
      ordinal: expect.any(Number),
      charStart: expect.any(Number),
      charEnd: expect.any(Number),
    })
    const gap = await generateProduct(data, store, { kind: '农业气象服务简报', stationId: grading.stationId, from: '2099-01-01T00:00:00Z', to: '2099-01-02T00:00:00Z', crop: '玉米' })
    expect(gap.body).toContain('观测数据暂无')
    expect(gap.body).toContain('预报数据暂无')
    const defaults = await generateProduct(data, store, { kind: '农业气象服务简报', stationId: grading.stationId, from: grading.from, to: grading.to })
    expect(defaults.body).toContain('农业气象服务简报服务提示')
    const noRules = await generateProduct(data, store, { kind: '农业气象服务简报', stationId: grading.stationId, from: grading.from, to: grading.to, hazard: '暴雨', crop: '不存在' })
    expect(noRules.body).toContain('暂无匹配阈值')
    expect(noRules.body).toContain('暂无作物历窗口')
    const polished = await generateProduct(data, store, { kind: '灾害预警产品', ...grading, forecastHours: 72, citationLimit: 5 }, async draft => ({ ...draft, body: draft.body.replace('服务提示', '专业服务提示') }))
    expect(polished.body).toContain('专业服务提示')
  })
  it('deduplicates repeated hazard grades and leaves failed attempts retryable by manual generation', async () => {
    await setup()
    const session = Session.create(SessionId('product-idempotency'))
    const serviceApi = service!
    const product = await serviceApi.hazardResolved(session, grading)
    const duplicate = await serviceApi.hazardResolved(session, grading)
    expect(duplicate.id).toBe(product.id)
    expect(serviceApi.list(session)).toHaveLength(1)
    const unavailableModel: ProductComposer = async () => { throw new Error('model unavailable') }
    const failing = { ...grading, grade: 'medium' }
    await expect(serviceApi.hazardResolved(session, failing, unavailableModel)).rejects.toThrow('model unavailable')
    expect(serviceApi.list(session)).toHaveLength(1)
    const manual = await serviceApi.generate(session, { kind: '农业气象服务简报', stationId: grading.stationId, from: grading.from, to: grading.to, crop: '玉米' })
    expect(manual.kind).toBe('农业气象服务简报')
    expect(serviceApi.list(session)).toHaveLength(2)
  })
  it('fails missing stations, missing hazard thresholds, and fabricated model numbers without retaining drafts', async () => {
    await setup()
    const session = Session.create(SessionId('product-failures'))
    const serviceApi = service!
    await expect(serviceApi.generate(session, { kind: '灾害预警产品', ...grading, stationId: 'unknown-station' })).rejects.toThrow(/Unknown station/)
    await expect(serviceApi.generate(session, { kind: '农业气象服务简报', stationId: grading.stationId, from: '2099-01-01T00:00:00Z', to: '2099-01-02T00:00:00Z', crop: '不存在' })).rejects.toThrow(/No meteorological data/)
    await expect(serviceApi.hazardResolved(session, { ...grading, hazard: '未知灾种' })).rejects.toThrow(/No threshold data/)
    const unknownId = 'missing-product' as DocumentProduct['id']
    expect(() => serviceApi.act(session, unknownId, 'submit', 'actor', '2026-01-01T00:00:00Z')).toThrow(/Unknown document product/)
    const fabricated: ProductComposer = async draft => ({ ...draft, body: `${draft.body} 987654` })
    await expect(serviceApi.hazardResolved(session, grading, fabricated)).rejects.toThrow(/Polish changed filled numbers/)
    expect(serviceApi.list(session)).toEqual([])
  })
  it('smokes real fixture generation through publication, archive, and event replay', async () => {
    await setup()
    const session = Session.create(SessionId('meteo-product-smoke'))
    const serviceApi = service!
    let product = await serviceApi.generate(session, { kind: '灾害预警产品', ...grading, forecastHours: 72, citationLimit: 5 })
    product = serviceApi.act(session, product.id, 'submit', 'forecaster', '2026-09-24T00:00:00Z').product
    product = serviceApi.act(session, product.id, 'approve', 'reviewer', '2026-09-24T00:01:00Z').product
    const publication = serviceApi.act(session, product.id, 'publish', 'publisher', '2026-09-24T00:02:00Z')
    product = serviceApi.act(session, product.id, 'archive', 'archivist', '2026-09-24T00:03:00Z').product
    const events = session.snapshotEvents()
    console.log('DOCUMENT_PRODUCT_SMOKE', JSON.stringify({ body: publication.release?.body, citations: publication.release?.citations, release: publication.release, state: product.state, events: events.map(event => event.type === 'meteo/product-transition' ? event.data : event.type) }))
    expect(publication.release?.version).toBe(1)
    expect(serviceApi.releases(session)).toEqual([publication.release])
    expect(product.state).toBe('archived')
    expect(events).toHaveLength(5)
  })
})
describe('hazard-grade generation entry point', () => {
  it('reads the whole forecast series and citation window when a grade carries neither bound', async () => {
    await setup()
    const activeCorpus = corpus
    const activeContext = context
    if (activeCorpus === undefined || activeContext === undefined) {
      throw new Error('Generation test setup did not create a corpus and context')
    }
    await activeCorpus.ingest({ sources: [{ title: '暴雨农业防御手册', source: 'fixture-guide-2', text: '暴雨预警应关注降水阈值与农事窗口，及时清理田间沟渠。' }] })
    const product = await generateFromResolvedHazard(activeContext.meteoData, activeContext.corpus, grading)
    const periods = new Set(product.provenance.filter(value => value.source.startsWith('forecast:')).map(value => value.period))
    expect(periods.has('2026-09-26T21:00:00Z')).toBe(true)
    expect(product.citations).toHaveLength(2)
  })
  it('honours the horizon and citation limit a grade carries', async () => {
    await setup()
    await corpus!.ingest({ sources: [{ title: '暴雨农业防御手册', source: 'fixture-guide-2', text: '暴雨预警应关注降水阈值与农事窗口，及时清理田间沟渠。' }] })
    const product = await generateFromResolvedHazard(
      context!.meteoData,
      context!.corpus,
      { ...grading, forecastHours: 24, citationLimit: 1 },
    )
    const periods = new Set(product.provenance.filter(value => value.source.startsWith('forecast:')).map(value => value.period))
    expect([...periods]).toEqual(['2026-09-24T00:00:00Z'])
    expect(product.citations).toHaveLength(1)
  })
})

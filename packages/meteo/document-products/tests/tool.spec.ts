/**
 * `meteo_document`: generation from bench fixtures, every legal transition with its
 * actor and instant, the refusals that keep an illegal action loud, and what a client
 * rebuilds from the result metadata.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Config as CorpusConfig } from '@deepseek-ai/dsh-meteo-corpus'
import { SqliteCorpusStore } from '@deepseek-ai/dsh-meteo-corpus'
import { LocalMeteoData } from '@deepseek-ai/dsh-meteo-data'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import { apply as applyProductPlugin } from '../src/plugin.ts'
import type { ProductId } from '../src/product.ts'
import { resolve } from '../src/config.ts'
import { documentResultMetaFromResult, formatDocumentResult, presentDocumentCall, presentDocumentResult } from '../src/tool.ts'

const fixtureDir = fileURLToPath(new URL('../../meteo-data/fixtures/', import.meta.url))
const STATION = 'hl-wc-01'
const PERIOD = { from: '2026-09-23T00:00:00Z', to: '2026-09-23T23:00:00Z' }
const BRIEF = { action: 'generate', kind: '农业气象服务简报', stationId: STATION, from: PERIOD.from, to: PERIOD.to, crop: '玉米' }
const CORPUS: Omit<CorpusConfig, 'path'> = { journalMode: 'delete', defaultLimit: 8, maxLimit: 50, maxMatchTokens: 64, maxChunkChars: 800, maxDocumentBytes: 4_000_000, embeddingBatchSize: 32, candidateLimit: 100 }

interface Harness {
  ctx: Context
  session: Session
  call: (args: Record<string, unknown>) => Promise<ToolExecutionResult>
  callWithoutAgent: (args: Record<string, unknown>) => Promise<ToolExecutionResult>
}

let root = ''
let corpus: SqliteCorpusStore | undefined
let mounted = 0

afterEach(async () => {
  await corpus?.close()
  if (root) await rm(root, { recursive: true, force: true })
  corpus = undefined
  root = ''
})

/** Mount the real data seam, corpus, tool registry, and the plugin's tool over them. */
async function setup(overrides: { snippetChars?: number; documentChars?: number } = {}): Promise<Harness> {
  root = await mkdtemp(join(tmpdir(), 'meteo-document-tool-'))
  const ctx = new Context()
  ctx.provide('textEmbeddings', {
    resolve: ({ texts, kind }: { texts: readonly string[]; kind: 'documents' | 'queries' }) => ({ texts, kind, provider: 'fixture-test' }),
    embed: async ({ texts }: { texts: readonly string[] }) => texts.map(text => [text.length, 1]),
  } as never)
  new LocalMeteoData(ctx, { source: 'fixture', fixtureDir, timeoutMs: 15_000 })
  const store = new SqliteCorpusStore(ctx, { ...CORPUS, path: join(root, 'corpus.sqlite') })
  corpus = store
  await store.ingest({ sources: [{ title: '东北玉米初霜防御指南', source: 'fixture-guide', text: '初霜临近玉米成熟收获期时应关注气温阈值和农事窗口，及时组织抢收并做好粮食晾晒。' }] })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  applyProductPlugin(ctx, resolve({ forecastHours: 72, citationLimit: 5, timeoutMs: 30_000, snippetChars: overrides.snippetChars ?? 200, documentChars: overrides.documentChars ?? 8_000, artifactDir: join(root, 'artifacts') }))
  const session = Session.create(SessionId(`meteo-document-tool-${String(++mounted)}`))
  const agent = { id: 'meteo-document-agent', session } as unknown as Agent
  let counter = 0
  const input = (args: Record<string, unknown>) => ({ signal: new AbortController().signal, callId: ToolCallId(`doc-${String(++counter)}`), name: 'meteo_document', arguments: args })
  return {
    ctx,
    session,
    call: args => ctx.tools.execute({ ...input(args), agent }),
    callWithoutAgent: args => ctx.tools.execute(input(args)),
  }
}

/** Generate one brief and report the product id its metadata carries. */
async function draftId(harness: Harness): Promise<string> {
  const out = await harness.call(BRIEF)
  const id = documentResultMetaFromResult(out.meta)?.products[0]?.id
  if (id === undefined) throw new Error('the generation call reported no product id')
  return id
}

/** The text a model reads from one executed call. */
function modelText(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

describe('meteo_document generation', () => {
  it('fills a draft from fixture data and renders its kind, state, version, and citations', async () => {
    const harness = await setup()
    const out = await harness.call(BRIEF)
    expect(out.isError).toBe(false)
    const text = modelText(out)
    expect(text).toContain('气象文档产品（meteo_document）：生成草稿')
    expect(text).toContain(`数据时段：${PERIOD.from} ~ ${PERIOD.to}`)
    expect(text).toContain('农业气象服务简报')
    expect(text).toContain('状态：草稿（draft）｜版本：v0｜可执行操作：编辑正文（edit）、提交审核（submit）')
    expect(text).toMatch(/引用依据 \d+ 条：/)
    expect(text).toContain('字符 ')
    expect(text).toContain('本次调用未记录状态变更。')
    expect(text).toContain('## 监测与预报')
    expect(text).toContain('## 正文')
    expect(text).toContain('服务提示')
    expect(text).toContain('东北玉米初霜防御指南')
    const held = harness.ctx.documentProducts.list(harness.session)
    expect(held).toHaveLength(1)
    expect(held[0]?.state).toBe('draft')
    const meta = documentResultMetaFromResult(out.meta)
    expect(meta?.action).toBe('generate')
    expect(meta?.actionLabel).toBe('生成草稿')
    expect(meta?.products[0]?.state).toBe('draft')
    expect(meta?.products[0]?.citations[0]?.documentId).toBeTruthy()
  })

  it('marks document text truncation when the configured result cap is exceeded', async () => {
    const harness = await setup({ documentChars: 20 })
    const result = await harness.call(BRIEF)
    expect(modelText(result)).toContain('…（文档文本已截断，完整发布件见发布路径）')
  })

  it('covers the station\'s published observation span when neither bound is given', async () => {
    const harness = await setup()
    const out = await harness.call({ action: 'generate', kind: '农业气象服务简报', stationId: STATION, crop: '玉米' })
    expect(out.isError).toBe(false)
    expect(modelText(out)).toContain(`数据时段：${PERIOD.from} ~ ${PERIOD.to}`)
  })

  it('refuses a half-specified period, a missing kind, and a missing station', async () => {
    const harness = await setup()
    const halfFrom = await harness.call({ action: 'generate', kind: '农业气象服务简报', stationId: STATION, from: PERIOD.from })
    expect(halfFrom.isError).toBe(true)
    expect(modelText(halfFrom)).toContain('takes both from and to, or neither')
    const halfTo = await harness.call({ action: 'generate', kind: '农业气象服务简报', stationId: STATION, to: PERIOD.to })
    expect(halfTo.isError).toBe(true)
    expect(modelText(halfTo)).toContain('takes both from and to, or neither')
    const noKind = await harness.call({ action: 'generate', stationId: STATION })
    expect(noKind.isError).toBe(true)
    expect(modelText(noKind)).toContain('needs kind')
    const noStation = await harness.call({ action: 'generate', kind: '农业气象服务简报' })
    expect(noStation.isError).toBe(true)
    expect(modelText(noStation)).toContain('needs stationId')
    const blankStation = await harness.call({ action: 'generate', kind: '农业气象服务简报', stationId: '   ' })
    expect(modelText(blankStation)).toContain('needs stationId')
  })

  it('asks for explicit bounds when the station publishes no observation', async () => {
    const ctx = new Context()
    ctx.provide('meteoData', { observations: async () => [] } as never)
    ctx.provide('corpus', {} as never)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    applyProductPlugin(ctx, { forecastHours: 72, citationLimit: 5, timeoutMs: 30_000, snippetChars: 200, documentChars: 8_000, artifactDir: 'outputs/test-artifacts' })
    const session = Session.create(SessionId('meteo-document-no-observation'))
    const agent = { id: 'sparse-agent', session } as unknown as Agent
    const out = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('doc-sparse'), name: 'meteo_document', arguments: { action: 'generate', kind: '农业气象服务简报', stationId: STATION }, agent })
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain(`found no published observation for station ${STATION}`)
  })

  it('fills a graded warning that names no crop and a brief that names only a crop', async () => {
    const harness = await setup()
    const warning = await harness.call({ action: 'generate', kind: '灾害预警产品', stationId: STATION, hazard: '暴雨', grade: 'high' })
    expect(warning.isError).toBe(false)
    expect(modelText(warning)).toContain('灾害预警产品')
    const brief = await harness.call({ action: 'generate', kind: '农业气象服务简报', stationId: STATION, crop: '大豆' })
    expect(brief.isError).toBe(false)
    expect(documentResultMetaFromResult(brief.meta)?.products[0]?.kind).toBe('农业气象服务简报')
  })

  it('refuses to operate without a session', async () => {
    const harness = await setup()
    const out = await harness.callWithoutAgent({ action: 'list' })
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain('needs an agent session')
  })
})

describe('meteo_document lifecycle', () => {
  it('walks draft, review, approval, publication, and archive with an actor and instant each', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    const submitted = await harness.call({ action: 'submit', productId: id, actor: 'forecaster' })
    const submittedText = modelText(submitted)
    expect(submittedText).toContain('状态：审核中（in_review）')
    expect(submittedText).toContain('本次调用记录的状态变更 1 条：')
    expect(submittedText).toContain('提交审核（submit）：草稿（draft） → 审核中（in_review）｜操作人 forecaster｜时间 ')
    expect(submittedText).toContain('可执行操作：审核通过（approve）、退回修改（reject）')
    expect(submittedText).toContain('状态历史 1 条：')
    const at = /｜操作人 forecaster｜时间 ([0-9T:.Z-]+)/.exec(submittedText)?.[1] ?? ''
    expect(Math.abs(Date.parse(at) - Date.now())).toBeLessThan(60_000)
    const approved = await harness.call({ action: 'approve', productId: id, actor: 'reviewer' })
    expect(modelText(approved)).toContain('已通过（approved）')
    expect(modelText(approved)).toContain('审核通过（approve）：审核中（in_review） → 已通过（approved）｜操作人 reviewer｜时间 ')
    expect(modelText(approved)).toContain('可执行操作：发布（publish）')
    const published = await harness.call({ action: 'publish', productId: id, actor: 'publisher' })
    const publishedText = modelText(published)
    expect(publishedText).toContain('版本：v1')
    expect(publishedText).toContain(`发布件：产品 ${id}｜版本 v1｜发布人 publisher｜发布时间 `)
    expect(publishedText).toContain('可执行操作：发布（publish）、归档（archive）')
    const archived = await harness.call({ action: 'archive', productId: id, actor: 'archivist' })
    expect(modelText(archived)).toContain('状态：已归档（archived）')
    expect(modelText(archived)).toContain('可执行操作：无（已归档，生命周期结束）')
    const held = harness.ctx.documentProducts.list(harness.session)
    expect(held[0]?.history.map(transition => transition.action)).toEqual(['submit', 'approve', 'publish', 'archive'])
    expect(held[0]?.version).toBe(1)
    expect(harness.ctx.documentProducts.releases(harness.session)).toHaveLength(1)
  })
  it('writes immutable, openable Markdown releases for each published version', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    await harness.call({ action: 'submit', productId: id, actor: 'forecaster' })
    await harness.call({ action: 'approve', productId: id, actor: 'reviewer' })
    const first = await harness.call({ action: 'publish', productId: id, actor: 'publisher' })
    const firstText = modelText(first)
    expect(firstText).toContain('版本 v1')
    expect(firstText).toContain('发布文件路径：')
    const firstPath = /发布文件路径：(.*)/.exec(firstText)?.[1]
    expect(firstPath).toBeTruthy()
    const firstContent = await readFile(firstPath!, 'utf8')
    expect(firstContent).toContain('# ')
    expect(firstContent).toContain('## 正文')
    expect(firstContent).toContain('服务提示')
    expect(firstContent).toContain('## 引用')
    expect(firstContent).toContain('东北玉米初霜防御指南')
    expect(firstContent).toContain('字符 ')
    expect((await stat(firstPath!)).size).toBeGreaterThan(100)
    const second = await harness.call({ action: 'publish', productId: id, actor: 'publisher' })
    const secondText = modelText(second)
    expect(secondText).toContain('版本 v2')
    const secondPath = /发布文件路径：(.*)/.exec(secondText)?.[1]
    expect(secondPath).toBeTruthy()
    expect(secondPath).not.toBe(firstPath)
    expect(await readFile(firstPath!, 'utf8')).toBe(firstContent)
    expect((await stat(secondPath!)).size).toBeGreaterThan(100)
  })


  it('edits and records the replacement body, then publishes that exact text', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    const before = harness.ctx.documentProducts.list(harness.session)[0]
    const body = '编辑后的服务建议：请持续关注玉米成熟期天气变化。'
    const edited = await harness.call({ action: 'edit', productId: id, actor: 'author', body })
    expect(edited.isError).toBe(false)
    expect(modelText(edited)).toContain(body)
    expect(modelText(edited)).toContain('版本：v0')
    expect(modelText(edited)).toContain('编辑正文（edit）：草稿（draft） → 草稿（draft）｜操作人 author')
    const changed = harness.ctx.documentProducts.list(harness.session)[0]
    expect(changed?.body).toBe(body)
    expect(changed?.citations).toEqual(before?.citations)
    expect(changed?.history.at(-1)).toMatchObject({ action: 'edit', actor: 'author', from: 'draft', to: 'draft' })
    await harness.call({ action: 'submit', productId: id, actor: 'forecaster' })
    await harness.call({ action: 'approve', productId: id, actor: 'reviewer' })
    const published = await harness.call({ action: 'publish', productId: id, actor: 'publisher' })
    const publishedText = modelText(published)
    const path = /发布文件路径：(.*)/.exec(publishedText)?.[1]
    expect(path).toBeTruthy()
    expect(await readFile(path!, 'utf8')).toContain(body)
    const editEvent = harness.session.snapshotEvents().find(event => event.type === 'meteo/product-transition' && event.data.action === 'edit')
    expect(editEvent?.type === 'meteo/product-transition' ? editEvent.data : undefined).toMatchObject({ action: 'edit', actor: 'author', body })
  })

  it('rejects an ungrounded number without changing the retained product', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    const before = harness.ctx.documentProducts.list(harness.session)[0]
    const rejected = await harness.call({ action: 'edit', productId: id, actor: 'author', body: '新增虚构数值 987654321。' })
    expect(rejected.isError).toBe(true)
    expect(modelText(rejected)).toContain('Unverified number in product body: 987654321')
    expect(harness.ctx.documentProducts.list(harness.session)[0]).toEqual(before)
  })

  it('refuses editing outside draft state and names the legal actions', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    await harness.call({ action: 'submit', productId: id, actor: 'forecaster' })
    const result = await harness.call({ action: 'edit', productId: id, actor: 'author', body: '不应写入' })
    expect(result.isError).toBe(true)
    expect(modelText(result)).toContain(`Illegal document transition: edit on product ${id} in state in_review; this state allows approve, reject`)
  })
  it('requires a replacement body for edits', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    const before = harness.ctx.documentProducts.list(harness.session)[0]
    const result = await harness.call({ action: 'edit', productId: id, actor: 'author' })
    expect(result.isError).toBe(true)
    expect(modelText(result)).toContain('edit needs body')
    expect(harness.ctx.documentProducts.list(harness.session)[0]).toEqual(before)
  })
  it('rejects an empty body and preserves the stored product and its citations', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    const before = harness.ctx.documentProducts.list(harness.session)[0]
    const result = await harness.call({ action: 'edit', productId: id, actor: 'author', body: '' })
    expect(result.isError).toBe(true)
    expect(modelText(result)).toContain('required 正文 section needs content')
    expect(harness.ctx.documentProducts.list(harness.session)[0]).toEqual(before)
  })

  it('returns a product for revision with the reviewer\'s note and revises it back to draft', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    await harness.call({ action: 'submit', productId: id, actor: 'forecaster' })
    const missingNote = await harness.call({ action: 'reject', productId: id, actor: 'reviewer' })
    expect(missingNote.isError).toBe(true)
    expect(modelText(missingNote)).toContain('reject needs note')
    const rejected = await harness.call({ action: 'reject', productId: id, actor: 'reviewer', note: '降水数据不足以支撑播种建议' })
    const rejectedText = modelText(rejected)
    expect(rejectedText).toContain('状态：已退回（rejected）')
    expect(rejectedText).toContain('退回修改（reject）：审核中（in_review） → 已退回（rejected）')
    expect(rejectedText).toContain('意见：降水数据不足以支撑播种建议')
    expect(rejectedText).toContain('可执行操作：重新编辑（revise）')
    const revised = await harness.call({ action: 'revise', productId: id, actor: 'forecaster', note: '已补充降水数据' })
    expect(modelText(revised)).toContain('状态：草稿（draft）')
    expect(modelText(revised)).toContain('意见：降水数据不足以支撑播种建议')
    expect(harness.ctx.documentProducts.list(harness.session)[0]?.state).toBe('draft')
  })
  it('revises without a retained or newly supplied note', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    const productId = brandString<ProductId>(id)
    harness.ctx.documentProducts.act(harness.session, productId, 'submit', 'forecaster', '2026-10-07T00:00:00Z')
    harness.ctx.documentProducts.act(harness.session, productId, 'reject', 'reviewer', '2026-10-07T00:01:00Z')
    const revised = await harness.call({ action: 'revise', productId: id, actor: 'forecaster' })
    expect(modelText(revised)).toContain('状态：草稿（draft）')
    expect(modelText(revised)).not.toContain('意见：')
  })

  it('refuses an illegal transition naming the state and the actions it allows', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    const illegal = await harness.call({ action: 'publish', productId: id, actor: 'publisher' })
    expect(illegal.isError).toBe(true)
    expect(modelText(illegal)).toContain(`Illegal document transition: publish on product ${id} in state draft; this state allows edit, submit`)
    expect(harness.ctx.documentProducts.list(harness.session)[0]?.state).toBe('draft')
    await harness.call({ action: 'submit', productId: id, actor: 'forecaster' })
    await harness.call({ action: 'approve', productId: id, actor: 'reviewer' })
    await harness.call({ action: 'publish', productId: id, actor: 'publisher' })
    await harness.call({ action: 'archive', productId: id, actor: 'archivist' })
    const closed = await harness.call({ action: 'submit', productId: id, actor: 'forecaster' })
    expect(closed.isError).toBe(true)
    expect(modelText(closed)).toContain('this state allows nothing (the product is archived and its lifecycle has ended)')
  })

  it('refuses a transition without a product id or an actor, and reports ids it does not hold', async () => {
    const harness = await setup()
    const noId = await harness.call({ action: 'submit', actor: 'forecaster' })
    expect(noId.isError).toBe(true)
    expect(modelText(noId)).toContain('needs productId')
    const noActor = await harness.call({ action: 'submit', productId: 'p-1', actor: '   ' })
    expect(noActor.isError).toBe(true)
    expect(modelText(noActor)).toContain('needs actor')
    const emptySession = await harness.call({ action: 'submit', productId: 'p-1', actor: 'forecaster' })
    expect(emptySession.isError).toBe(true)
    expect(modelText(emptySession)).toContain('this session holds no document product yet')
    const id = await draftId(harness)
    const unknown = await harness.call({ action: 'submit', productId: 'p-missing', actor: 'forecaster' })
    expect(unknown.isError).toBe(true)
    expect(modelText(unknown)).toContain(`products in this session: ${id}`)
  })

  it('lists what the session holds, including the warning product a resolved hazard wrote', async () => {
    const harness = await setup()
    await harness.ctx.documentProducts.hazardResolved(harness.session, { stationId: STATION, from: PERIOD.from, to: PERIOD.to, hazard: '暴雨', grade: 'high' })
    const listed = await harness.call({ action: 'list' })
    expect(listed.isError).toBe(false)
    const text = modelText(listed)
    expect(text).toContain('气象文档产品（meteo_document）：会话产品')
    expect(text).toContain('灾害预警产品')
    expect(text).toContain('状态：草稿（draft）｜版本：v0')
    expect(text).toContain('本次调用未记录状态变更。')
    expect(documentResultMetaFromResult(listed.meta)?.products).toHaveLength(1)
  })
})

describe('meteo_document presentation', () => {
  it('titles the pending call by its action and the completed card from its metadata', async () => {
    const harness = await setup()
    expect(presentDocumentCall({ action: 'generate', stationId: STATION })).toEqual({ card: 'generic', title: '气象文档产品：生成草稿', kind: 'edit', rawInput: STATION })
    expect(presentDocumentCall({ action: 'list' })).toEqual({ card: 'generic', title: '气象文档产品：会话产品', kind: 'read' })
    const id = await draftId(harness)
    const submitted = await harness.call({ action: 'submit', productId: id, actor: 'forecaster' })
    const view = presentDocumentResult({ action: 'submit' }, {
      content: submitted.content,
      isError: submitted.isError,
      ...(submitted.meta === undefined ? {} : { meta: submitted.meta }),
    })
    const cardText = (view?.content ?? []).map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(view?.title).toBe('气象文档产品：提交审核')
    expect(cardText).toContain(`${id}｜农业气象服务简报｜in_review｜v0｜引用 `)
    expect(cardText).toContain('submit: draft → in_review · forecaster · ')
  })

  it('falls back to the generic card when the call failed or the metadata is unusable', () => {
    const content = [{ type: 'text' as const, text: 'x' }]
    const args = { action: 'list' as const }
    const product = { id: 'p', kind: '农业气象服务简报', title: 't', state: 'draft', version: 0, citations: [], transitions: [] }
    expect(presentDocumentResult(args, { content, isError: true })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: 'nope' })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: null })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: [] })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'unknown-action' } })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'list' } })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'list', products: {} } })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'list', products: [{ ...product, id: 7 }], performed: [] } })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'list', products: [{ ...product, citations: 'x' }], performed: [] } })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'list', products: [{ ...product, transitions: 'x' }], performed: [] } })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'list', products: [{ ...product, citations: [{ documentId: 'd' }] }], performed: [] } })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'list', products: [], performed: 'x' } })).toBeUndefined()
    expect(presentDocumentResult(args, { content, isError: false, meta: { action: 'list', products: [], performed: [] } })).toEqual({ card: 'generic', title: '气象文档产品：会话产品' })
  })

  it('formats a result that never went through the tool runtime', () => {
    const bare = formatDocumentResult({ action: 'list', products: [{ id: 'p-1', kind: '农业气象服务简报', title: '城关镇农业气象服务简报', state: 'draft', version: 0, document: '# 标题', citations: [], transitions: [] }], performed: [] }, 200)
    expect(bare).toContain('- 产品 p-1｜农业气象服务简报｜「城关镇农业气象服务简报」')
    expect(bare).toContain('状态：草稿（draft）｜版本：v0｜可执行操作：编辑正文（edit）、提交审核（submit）')
    expect(bare).not.toContain('引用依据')
    expect(bare).not.toContain('状态历史')
    expect(bare).toContain('本次调用未记录状态变更。')
    const transition = { from: 'rejected' as const, to: 'draft' as const, action: 'revise' as const, actor: 'forecaster', at: '2026-10-07T00:00:00.000Z' }
    const revised = formatDocumentResult({
      action: 'revise',
      products: [{ id: 'p-1', kind: '灾害预警产品', title: '城关镇暴雨灾害预警产品', state: 'draft', version: 1, document: '# 标题', citations: [{ documentId: 'guide-1', ordinal: 0, charStart: 0, charEnd: 9, claim: '播种期大风防御', text: '很长的语料文本内容' }], transitions: [transition] }],
      performed: [transition],
      note: '已补充降水数据',
    }, 4)
    expect(revised).toContain('引用依据 1 条：')
    expect(revised).toContain('｜很长的…')
    expect(revised).toContain('状态历史 1 条：')
    expect(revised).toContain('重新编辑（revise）：已退回（rejected） → 草稿（draft）｜操作人 forecaster｜时间 2026-10-07T00:00:00.000Z')
    expect(revised).toContain('本次调用记录的状态变更 1 条：')
    expect(revised).toContain('意见：已补充降水数据')
  })
  it('renders results with no product and includes a release path only when the tool returned a release', () => {
    const transition = { from: 'approved' as const, to: 'published' as const, action: 'publish' as const, actor: 'publisher', at: '2026-10-07T00:00:00.000Z' }
    const released = formatDocumentResult({
      action: 'publish',
      products: [],
      performed: [transition],
      release: {
        productId: 'p-1',
        version: 2,
        publishedAt: transition.at,
        actor: transition.actor,
        title: '城关镇农业气象服务简报',
        artifactPath: 'artifacts/p-1-v2.md',
      },
    }, 200)
    expect(released).toContain('本次调用未返回文档产品。')
    expect(released).toContain('发布件：产品 p-1｜版本 v2｜发布人 publisher｜发布时间 2026-10-07T00:00:00.000Z｜文件 artifacts/p-1-v2.md')
    expect(released).toContain('发布文件路径：artifacts/p-1-v2.md')
    expect(released).toContain('发布（publish）：已通过（approved） → 已发布（published）｜操作人 publisher｜时间 2026-10-07T00:00:00.000Z')
    const archived = formatDocumentResult({ action: 'archive', products: [], performed: [] }, 200)
    expect(archived).toContain('本次调用未返回文档产品。')
    expect(archived).not.toContain('发布件：')
    expect(archived).not.toContain('发布文件路径：')
  })

  it('renders a result for every action through the tool lifecycle', async () => {
    const harness = await setup()
    const id = await draftId(harness)
    const generated = modelText(await harness.call(BRIEF))
    expect(generated).toContain('## 监测与预报')
    expect(modelText(await harness.call({ action: 'list' }))).toContain('- 产品 ')
    expect(modelText(await harness.call({ action: 'submit', productId: id, actor: 'forecaster' }))).toContain('提交审核（submit）：草稿（draft） → 审核中（in_review）')
    expect(modelText(await harness.call({ action: 'reject', productId: id, actor: 'reviewer', note: '补充材料' }))).toContain('意见：补充材料')
    expect(modelText(await harness.call({ action: 'revise', productId: id, actor: 'forecaster' }))).toContain('重新编辑（revise）：已退回（rejected） → 草稿（draft）')
    expect(modelText(await harness.call({ action: 'submit', productId: id, actor: 'forecaster' }))).toContain('提交审核（submit）：草稿（draft） → 审核中（in_review）')
    expect(modelText(await harness.call({ action: 'approve', productId: id, actor: 'reviewer' }))).toContain('审核通过（approve）：审核中（in_review） → 已通过（approved）')
    const published = modelText(await harness.call({ action: 'publish', productId: id, actor: 'publisher' }))
    expect(published).toContain('版本 v1')
    expect(published).toContain('发布文件路径：')
    expect(modelText(await harness.call({ action: 'archive', productId: id, actor: 'archivist' }))).toContain('归档（archive）：已发布（published） → 已归档（archived）')
  })

  it('declares its budget, its exclusive scheduling, and its excerpt cap', async () => {
    const harness = await setup({ snippetChars: 8 })
    expect(harness.ctx.tools.get('meteo_document')?.timeoutMs).toBe(30_000)
    expect(harness.ctx.tools.executionMode({ signal: new AbortController().signal, callId: 'doc-mode' as never, name: 'meteo_document', arguments: { action: 'list' } })).toEqual({ kind: 'exclusive' })
    const out = await harness.call(BRIEF)
    const excerpt = documentResultMetaFromResult(out.meta)?.products[0]?.citations[0]?.excerpt ?? ''
    expect(Array.from(excerpt)).toHaveLength(8)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(modelText(out)).toContain(excerpt)
  })
})

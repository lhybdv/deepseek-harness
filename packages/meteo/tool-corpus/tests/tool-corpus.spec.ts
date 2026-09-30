/**
 * Behaviour tests for the corpus tools as the model and a client see them: the
 * seam request each call issues, the rendered text, the replayable metadata, the
 * argument rules the schema cannot state, the config bounds, and the visibility
 * of the guidance section.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  CorpusChunk,
  CorpusDocument,
  CorpusDocumentId,
  CorpusHit,
  IngestRequest,
  IngestResult,
  RemoveResult,
  SearchRequest,
  SearchResult,
} from '@deepseek-ai/dsh-meteo-corpus'
import { CorpusStore } from '@deepseek-ai/dsh-meteo-corpus'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult, type ToolResult } from '@deepseek-ai/dsh-tools'
import * as ToolCorpus from '@deepseek-ai/dsh-tool-corpus'
import type { Config } from '@deepseek-ai/dsh-tool-corpus'

const DOC_ID = brandString<CorpusDocumentId>('doc-1')

const CHUNK: CorpusChunk = {
  docId: DOC_ID,
  ordinal: 0,
  headingPath: '施药适宜气象条件',
  charStart: 12,
  charEnd: 240,
  text: '风速低于 3 米每秒',
}

const HIT: CorpusHit = { ...CHUNK, docTitle: '病虫害防治气象指标', score: 1.9 }

/** `tool:corpus` as rendered with the shipped config defaults. */
const GUIDANCE = 'Use corpus_search when an answer must come from documents indexed by this deployment: pass the '
  + 'question as query and add the terms you derive from it (disaster type, crop, activity, weather element), '
  + 'because recall unions both. It returns 8 chunks by default and 20 at the most, ranked, each with a document '
  + 'title, a chunk ordinal, and a character range. A chunk is an excerpt: when an excerpt is not enough, call '
  + 'corpus_read with the docId and ordinal of that hit to reopen the whole chunk. Every conclusion drawn from a '
  + 'chunk must cite the document title, the chunk ordinal, and the character range. When nothing matches, say the '
  + 'indexed documents do not cover the question instead of inventing a citation. Index new documents with '
  + 'corpus_ingest, at most 10 documents and 200000 characters in total per call.'

const PERSONA = 'You are an AI agent powered by DeepSeek Harness.'

class StubStore extends CorpusStore {
  readonly ingestRequests: IngestRequest[] = []
  readonly searchRequests: SearchRequest[] = []
  readonly readRequests: { docId: string; ordinal: number }[] = []
  ingestOutcome: IngestResult = { documents: [], failures: [] }
  searchHits: CorpusHit[] = [HIT]
  chunk: CorpusChunk | undefined = CHUNK

  async ingest(request: IngestRequest): Promise<IngestResult> {
    this.ingestRequests.push(request)
    return this.ingestOutcome
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    this.searchRequests.push(request)
    return { hits: this.searchHits.slice(0, request.limit), matchExpression: '"打药" OR "施药"' }
  }

  async readChunk(docId: CorpusDocumentId, ordinal: number): Promise<CorpusChunk | undefined> {
    this.readRequests.push({ docId, ordinal })
    return this.chunk
  }

  async listDocuments(): Promise<CorpusDocument[]> {
    return []
  }

  async remove(docId: CorpusDocumentId): Promise<RemoveResult> {
    return { docId, removed: false }
  }
}

const testToolSignal = new AbortController().signal

/** Mount the real registry, prompt service, and a stubbed corpus behind the tools. */
async function mountTools(config: Config = {}): Promise<{
  ctx: Context
  store: StubStore
  call: (name: string, args: unknown) => Promise<ToolExecutionResult>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StubStore)
  await ctx.plugin(ToolCorpus, config)
  const store = ctx.corpus as StubStore
  let counter = 0
  const call = (name: string, args: unknown) => ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++counter}`),
    name,
    arguments: args,
  })
  return { ctx, store, call }
}

const modelText = (result: ToolExecutionResult): string =>
  result.content.map(block => block.type === 'text' ? block.text : '').join('\n')

/** The final model-facing result, as a client reads it back from a logged call. */
function asToolResult(result: ToolExecutionResult): ToolResult {
  return { content: result.content, isError: result.isError, ...result.meta === undefined ? {} : { meta: result.meta } }
}

describe('corpus_ingest', () => {
  it('hands the seam the submitted documents and reports what the index accepted and refused', async () => {
    const { store, call } = await mountTools()
    store.ingestOutcome = {
      documents: [{
        docId: DOC_ID, title: '病虫害防治气象指标', source: 'guide.md', bytes: 320, chunkCount: 2, ingestedAt: 1700000000000,
      }],
      failures: [{ title: '空文档', code: 'CORPUS_EMPTY_DOCUMENT', message: 'document text is empty' }],
    }
    const out = await call('corpus_ingest', {
      documents: [{ title: '病虫害防治气象指标', text: '风速低于 3 米每秒', source: 'guide.md' }],
    })
    expect(store.ingestRequests).toEqual([{
      sources: [{ title: '病虫害防治气象指标', text: '风速低于 3 米每秒', source: 'guide.md' }],
    }])
    expect(out.isError).toBe(false)
    expect(modelText(out)).toContain('Indexed 1 documents: 2 chunks, 320 bytes.')
    expect(modelText(out)).toContain('- doc-1 | 病虫害防治气象指标 | chunks 2 | bytes 320 | source guide.md')
    expect(modelText(out)).toContain('- 空文档 | CORPUS_EMPTY_DOCUMENT: document text is empty')
    expect(out.meta).toEqual({ indexed: 1, rejected: 1, titles: ['病虫害防治气象指标'] })
  })

  it('submits an empty provenance string for a document the caller gave no source for', async () => {
    const { store, call } = await mountTools()
    const out = await call('corpus_ingest', { documents: [{ title: '霜冻指标', text: '霜冻' }] })
    expect(store.ingestRequests[0]?.sources).toEqual([{ title: '霜冻指标', text: '霜冻', source: '' }])
    expect(modelText(out)).toBe('Indexed 0 documents.')
    expect(out.meta).toEqual({ indexed: 0, rejected: 0, titles: [] })
  })

  it.each([
    ['an empty batch', { documents: [] }, /documents must contain at least one document/],
    [
      'too many documents',
      { documents: Array.from({ length: 11 }, (_unused, index) => ({ title: `d${index}`, text: 'x' })) },
      /documents must contain at most 10 documents/,
    ],
  ])('refuses %s before the seam sees it', async (_label, args, message) => {
    const { store, call } = await mountTools()
    const out = await call('corpus_ingest', args)
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain(message.source)
    expect(store.ingestRequests).toEqual([])
  })

  it('refuses a batch that exceeds the configured character budget', async () => {
    const { store, call } = await mountTools({ maxIngestChars: 10 })
    const out = await call('corpus_ingest', { documents: [{ title: 'a', text: 'x'.repeat(20) }] })
    expect(modelText(out)).toContain('documents must contain at most 10 characters in total, got 20')
    expect(store.ingestRequests).toEqual([])
  })
})

describe('corpus_search', () => {
  it('unions the question with the derived terms and cites every hit', async () => {
    const { store, call } = await mountTools()
    store.searchHits = [HIT, { ...HIT, ordinal: 1, charStart: 240, charEnd: 480, text: '气温宜在 15 至 28 摄氏度' }]
    const out = await call('corpus_search', { query: ' 明天能打药吗 ', terms: ['施药', '风速'] })
    expect(store.searchRequests).toEqual([{ query: '明天能打药吗', terms: ['施药', '风速'], limit: 8 }])
    expect(modelText(out)).toContain('Matched 2 chunks (most relevant first).')
    expect(modelText(out)).toContain('[1] 病虫害防治气象指标 | docId doc-1 | chunk 0 | chars 12-240 | heading 施药适宜气象条件\n风速低于 3 米每秒')
    expect(modelText(out)).toContain('[2] 病虫害防治气象指标 | docId doc-1 | chunk 1 | chars 240-480 | heading 施药适宜气象条件\n气温宜在 15 至 28 摄氏度')
    expect(modelText(out)).toContain('Call corpus_read with a docId and chunk ordinal to reopen one verbatim.')
    expect(out.meta).toEqual({
      citations: [
        {
          docId: 'doc-1', ordinal: 0, docTitle: '病虫害防治气象指标', headingPath: '施药适宜气象条件',
          charStart: 12, charEnd: 240, snippet: '风速低于 3 米每秒',
        },
        {
          docId: 'doc-1', ordinal: 1, docTitle: '病虫害防治气象指标', headingPath: '施药适宜气象条件',
          charStart: 240, charEnd: 480, snippet: '气温宜在 15 至 28 摄氏度',
        },
      ],
      truncated: false,
    })
  })

  it('asks for the configured window when the model names no limit', async () => {
    const { store, call } = await mountTools({ defaultLimit: 2 })
    store.searchHits = [HIT, { ...HIT, ordinal: 1 }, { ...HIT, ordinal: 2 }]
    const out = await call('corpus_search', { query: '打药' })
    expect(store.searchRequests).toEqual([{ query: '打药', terms: [], limit: 2 }])
    expect(modelText(out)).toContain('(Showing the first 2 matches; the corpus may hold more.')
    expect(out.meta).toMatchObject({ truncated: true })
  })

  it('honours a limit the model asks for within the bound', async () => {
    const { store, call } = await mountTools({ defaultLimit: 4, maxLimit: 4 })
    store.searchHits = [HIT, { ...HIT, ordinal: 1 }]
    const out = await call('corpus_search', { query: '打药', limit: 2 })
    expect(store.searchRequests).toEqual([{ query: '打药', terms: [], limit: 2 }])
    expect(out.meta).toMatchObject({ truncated: true })
  })

  it('reports an empty retrieval without a refine note', async () => {
    const { store, call } = await mountTools()
    store.searchHits = []
    const out = await call('corpus_search', { query: '冰雹' })
    expect(modelText(out)).toBe('No chunk matched. Search again with broader terms, or index the document with corpus_ingest.')
    expect(out.meta).toEqual({ citations: [], truncated: false })
  })

  it('caps each citation excerpt at the configured length', async () => {
    const { call } = await mountTools({ maxSnippetChars: 4 })
    const out = await call('corpus_search', { query: '打药' })
    expect(out.meta).toMatchObject({ citations: [{ snippet: '风速低…' }] })
  })

  it.each([
    ['a blank question', { query: '   ' }, /query must be a non-empty string/],
    ['a blank term', { query: '打药', terms: ['施药', ' '] }, /each term must be a non-empty string/],
    ['limit 0', { query: '打药', limit: 0 }, /limit must be between 1 and 20/],
    ['a limit above the bound', { query: '打药', limit: 21 }, /limit must be between 1 and 20/],
  ])('refuses %s', async (_label, args, message) => {
    const { store, call } = await mountTools()
    const out = await call('corpus_search', args)
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain(message.source)
    expect(store.searchRequests).toEqual([])
  })
})

describe('corpus_read', () => {
  it('reopens the chunk the search hit pointed at', async () => {
    const { store, call } = await mountTools()
    const out = await call('corpus_read', { docId: ' doc-1 ', ordinal: 0 })
    expect(store.readRequests).toEqual([{ docId: 'doc-1', ordinal: 0 }])
    expect(modelText(out))
      .toBe('Chunk 0 of document doc-1 | chars 12-240 | heading 施药适宜气象条件\n\n风速低于 3 米每秒')
    expect(out.meta).toEqual({
      docId: 'doc-1', ordinal: 0, found: true, headingPath: '施药适宜气象条件', chars: 228,
    })
  })

  it('renders a chunk from a document without headings', async () => {
    const { store, call } = await mountTools()
    store.chunk = { ...CHUNK, headingPath: '' }
    const out = await call('corpus_read', { docId: 'doc-1', ordinal: 0 })
    expect(modelText(out)).toBe('Chunk 0 of document doc-1 | chars 12-240\n\n风速低于 3 米每秒')
    expect(out.meta).toMatchObject({ found: true, headingPath: '' })
  })

  it('says the chunk is gone when the index no longer holds it', async () => {
    const { store, call } = await mountTools()
    store.chunk = undefined
    const out = await call('corpus_read', { docId: 'doc-1', ordinal: 7 })
    expect(modelText(out))
      .toBe('Document doc-1 has no chunk 7. Run corpus_search again for a docId and chunk ordinal the index holds now.')
    expect(out.meta).toEqual({ docId: 'doc-1', ordinal: 7, found: false, headingPath: '', chars: 0 })
  })

  it.each([
    ['a blank docId', { docId: '  ', ordinal: 0 }, /docId must be a non-empty string/],
    ['a negative ordinal', { docId: 'doc-1', ordinal: -1 }, /ordinal must be zero or a positive integer/],
  ])('refuses %s', async (_label, args, message) => {
    const { store, call } = await mountTools()
    const out = await call('corpus_read', args)
    expect(out.isError).toBe(true)
    expect(modelText(out)).toContain(message.source)
    expect(store.readRequests).toEqual([])
  })
})

describe('registered presenters', () => {
  const ingestArgs = { documents: [{ title: '病虫害防治气象指标', text: '风速低于 3 米每秒', source: 'guide.md' }] }

  it('rebuilds the ingest card from the counts the index reported', async () => {
    const { ctx, store, call } = await mountTools()
    store.ingestOutcome = {
      documents: [{
        docId: DOC_ID, title: '病虫害防治气象指标', source: 'guide.md', bytes: 320, chunkCount: 2, ingestedAt: 1700000000000,
      }],
      failures: [{ title: '空文档', code: 'CORPUS_EMPTY_DOCUMENT', message: 'document text is empty' }],
    }
    const out = await call('corpus_ingest', ingestArgs)
    expect(ctx.tools.get('corpus_ingest')?.presentResult?.(ingestArgs, asToolResult(out))).toEqual({
      card: 'generic',
      title: 'Indexed 1 of 2 documents',
      content: [{ type: 'text', text: '- 病虫害防治气象指标' }],
    })
  })

  it('rebuilds the search card from the citations the retrieval produced', async () => {
    const { ctx, call } = await mountTools()
    const out = await call('corpus_search', { query: '明天能打药吗' })
    expect(ctx.tools.get('corpus_search')?.presentResult?.({ query: '明天能打药吗' }, asToolResult(out))).toEqual({
      card: 'generic',
      title: '明天能打药吗',
      content: [{ type: 'text', text: '- 病虫害防治气象指标 | chunk 0 | chars 12-240' }],
    })
  })

  it('rebuilds the read card from the chunk that was reopened', async () => {
    const { ctx, call } = await mountTools()
    const out = await call('corpus_read', { docId: 'doc-1', ordinal: 0 })
    expect(ctx.tools.get('corpus_read')?.presentResult?.({ docId: 'doc-1', ordinal: 0 }, asToolResult(out))).toEqual({
      card: 'generic',
      title: 'Read 228 characters (chunk 0)',
      content: [{ type: 'text', text: '施药适宜气象条件' }],
    })
  })

  it('falls back to the generic card for args a newer schema would not accept', async () => {
    const { ctx, call } = await mountTools()
    const out = await call('corpus_read', { docId: 'doc-1', ordinal: 0 })
    expect(ctx.tools.get('corpus_read')?.presentResult?.({ docId: '' }, asToolResult(out))).toBeUndefined()
  })
})

describe('config', () => {
  it('states the retrieval window it grants the model and budgets each call', async () => {
    const { ctx } = await mountTools({ defaultLimit: 1, maxLimit: 2, timeoutMs: 1500 })
    expect(ctx.tools.get('corpus_search')?.description).toContain('default 1, 2 at the most')
    expect(ctx.tools.get('corpus_search')?.timeoutMs).toBe(1500)
    expect(ctx.tools.get('corpus_ingest')?.timeoutMs).toBe(1500)
    expect(ctx.tools.get('corpus_read')?.timeoutMs).toBe(1500)
  })

  it.each([
    ['corpus_search', { query: '打药' }, { kind: 'parallel' }],
    ['corpus_read', { docId: 'doc-1', ordinal: 0 }, { kind: 'parallel' }],
    ['corpus_ingest', { documents: [{ title: 'a', text: 'x' }] }, { kind: 'exclusive' }],
  ])('schedules %s as %j', async (name, args, mode) => {
    const { ctx } = await mountTools()
    expect(ctx.tools.executionMode({
      signal: testToolSignal,
      callId: ToolCallId('call-mode'),
      name,
      arguments: args,
    })).toEqual(mode)
  })

  it.each([['defaultLimit', 0], ['maxLimit', -1], ['maxSnippetChars', 0], ['maxIngestDocuments', 0], ['maxIngestChars', 0], ['timeoutMs', 1.5]])(
    'rejects a non-positive or fractional %s at load', async (name, value) => {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(StubStore)
      await expect(ctx.plugin(ToolCorpus, { [name]: value })).rejects
        .toThrow(new RegExp(`tool-corpus: ${name} must be a positive integer`))
    })

  it('rejects a default window larger than the bound', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(StubStore)
    await expect(ctx.plugin(ToolCorpus, { defaultLimit: 30, maxLimit: 20 })).rejects
      .toThrow('tool-corpus: defaultLimit must not exceed maxLimit')
  })
})

describe('tool:corpus guidance', () => {
  /** Create a real per-agent scope over the mounted tools. */
  async function guidanceScope(ctx: Context) {
    const key = {}
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) },
      { inject: ['tools', 'systemPrompt'] }))
    return { key, scope }
  }

  it('names the three tools and states the default window', async () => {
    const { ctx } = await mountTools()
    const { scope } = await guidanceScope(ctx)
    const assembly = await ctx.systemPrompt.assemble({ scope })
    expect(assembly.tools.map(tool => tool.name).sort())
      .toEqual(['corpus_ingest', 'corpus_read', 'corpus_search'])
    expect(renderPrompt(assembly)).toBe(`${PERSONA}\n\n${GUIDANCE}`)
    await scope.dispose()
  })

  it('disappears from a scope whose tools are hidden', async () => {
    const { ctx } = await mountTools()
    const { key, scope } = await guidanceScope(ctx)
    const release = scope.ctx.tools.restrict({ allow: [] })
    try {
      const assembly = await ctx.systemPrompt.assemble({ scope: key })
      expect(assembly.tools).toEqual([])
      expect(renderPrompt(assembly)).toBe(PERSONA)
    } finally {
      release()
      await scope.dispose()
    }
  })

  it('registers no tools or guidance once the plugin is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(StubStore)
    const fiber = await ctx.plugin(ToolCorpus, {})
    const { scope } = await guidanceScope(ctx)
    await fiber.dispose()
    expect(ctx.tools.get('corpus_search')).toBeUndefined()
    expect(ctx.tools.get('corpus_ingest')).toBeUndefined()
    expect(ctx.tools.get('corpus_read')).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope }))).toBe(PERSONA)
  })
})

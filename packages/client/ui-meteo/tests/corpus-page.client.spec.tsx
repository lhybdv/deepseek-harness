// @vitest-environment jsdom
/**
 * The corpus page over a scripted face.
 *
 * What the page owes: it reads the index once at mount, every gesture replaces
 * what the Host answered with rather than patching locally, and the upload
 * path refuses a file it cannot decode itself — naming the file and the reason,
 * so one bad pick never hides the files that were accepted. A refused source
 * stays in the batch, because the reader's fix is to correct the source and
 * send it again, not to find the file on disk a second time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { MeteoChunk, MeteoDocument, MeteoSearchHit } from '@deepseek-ai/dsh-api-meteo-controller/types'
import {
  CorpusPage, MAX_STAGED_CHARS, documentMetaText, hitRangeText, isTextFileName, refusalText, stagedRefusalText,
  titleOfFileName,
} from '../src/client/CorpusPage.tsx'
import type { MeteoFace } from '../src/client/face.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const failure = new RemoteError('gateway/internal', 'index is closed', {}) as RemoteFailure
const failed = (): Promise<RemoteResult<never>> => Promise.resolve({ ok: false, error: failure })
const ok = <T,>(value: T): Promise<RemoteResult<T>> => Promise.resolve({ ok: true, value })

const DOC: MeteoDocument = {
  docId: 'doc-1', title: '农业气象手册', source: '省局', bytes: 120, chunkCount: 2, ingestedAt: 0,
}
const HIT: MeteoSearchHit = {
  docId: 'doc-1', docTitle: '农业气象手册', ordinal: 4, headingPath: '第三章',
  charStart: 120, charEnd: 240, score: 1.5, excerpt: '打药应避开午后高温时段。',
}
const CHUNK: MeteoChunk = {
  docId: 'doc-1', ordinal: 4, headingPath: '第三章 施药', charStart: 120, charEnd: 240,
  text: '施药应避开午后高温时段，风力大于三级时不得作业。',
}

/** A face whose calls are stubs, overridable per test. */
function faceOf(overrides: Partial<MeteoFace> = {}): MeteoFace {
  return {
    listDocuments: vi.fn(async () => ok([])),
    removeDocument: vi.fn(async () => ok({ docId: 'doc-1', removed: true })),
    ingest: vi.fn(async () => ok({ documents: [], failures: [] })),
    search: vi.fn(async () => ok({ hits: [], matchExpression: 'x' })),
    readChunk: vi.fn(async () => failed()),
    readFocus: vi.fn(async () => ok(null)),
    ...overrides,
  }
}

/** Mount the page and let its mount-time listing settle. */
async function mount(face: MeteoFace) {
  const view = render(<CorpusPage meteo={face} t={t} />)
  await waitFor(() => { expect(face.listDocuments).toHaveBeenCalled() })
  await waitFor(() => { expect(screen.queryByText(zh['page.loading'])).toBeNull() })
  return { view }
}

/** Hand the file input a batch, as a picker would. */
async function pick(...files: File[]): Promise<void> {
  fireEvent.change(screen.getByTestId('corpus-file-input'), { target: { files } })
  await waitFor(() => { expect(screen.getByTestId('corpus-file-input')).toBeTruthy() })
}

/** A staged text file with the given body. */
function fileOf(name: string, body: string): File {
  return new File([body], name, { type: 'text/markdown' })
}

afterEach(cleanup)

describe('CorpusPage listing', () => {
  it('reads the index at mount and lists what it holds', async () => {
    await mount(faceOf({ listDocuments: vi.fn(async () => ok([DOC])) }))
    expect(screen.getByText('农业气象手册')).toBeTruthy()
    expect(screen.getByText(documentMetaText(t, DOC))).toBeTruthy()
  })

  it('says the index is empty rather than showing an empty list', async () => {
    await mount(faceOf())
    expect(screen.getByText(zh['page.empty'])).toBeTruthy()
  })

  it('reports a failed listing and keeps no list', async () => {
    await mount(faceOf({ listDocuments: vi.fn(async () => failed()) }))
    expect(screen.getByRole('alert').textContent).toBe('读取文档列表失败：index is closed')
    expect(screen.queryByText(zh['page.empty'])).toBeNull()
  })

  it('re-reads the index when the reader asks', async () => {
    const list = vi.fn(async () => ok([DOC]))
    await mount(faceOf({ listDocuments: list }))
    fireEvent.click(screen.getByRole('button', { name: zh['page.reload'] }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  })
})

describe('CorpusPage upload', () => {
  it('stages a text file with its size, and will not index an empty batch', async () => {
    const face = faceOf()
    await mount(face)
    const submit = screen.getByRole('button', { name: zh['ingest.submit'] })
    expect(submit).toHaveProperty('disabled', true)
    const picked = fileOf('manual.md', '# 施药\n避开午后高温。')
    await pick(picked)
    await waitFor(() => { expect(screen.getByText('manual.md')).toBeTruthy() })
    expect(screen.getByText(zh['page.size'].replace('{size}', String(picked.size)))).toBeTruthy()
    expect(submit).toHaveProperty('disabled', false)
    expect(face.ingest).not.toHaveBeenCalled()
  })

  it('refuses a file it cannot decode itself, naming the file and the reason', async () => {
    const face = faceOf()
    await mount(face)
    await pick(fileOf('scan.pdf', 'binary-ish'))
    await waitFor(() => { expect(screen.getByText(zh['ingest.rejected'].replace('{title}', 'scan.pdf').replace('{reason}', zh['ingest.reject.binary']))).toBeTruthy() })
    expect(screen.queryByRole('button', { name: zh['ingest.submit'] })).toHaveProperty('disabled', true)
    expect(face.ingest).not.toHaveBeenCalled()
  })

  it('refuses an empty file and an over-long one, and still stages the good pick in the same batch', async () => {
    await mount(faceOf())
    await pick(fileOf('blank.txt', '   \n  '), fileOf('huge.txt', 'x'.repeat(MAX_STAGED_CHARS + 1)), fileOf('good.txt', '正文'))
    await waitFor(() => { expect(screen.getByText('good.txt')).toBeTruthy() })
    expect(screen.getByText(zh['ingest.rejected'].replace('{title}', 'blank.txt').replace('{reason}', zh['ingest.reject.empty']))).toBeTruthy()
    expect(screen.getByText(zh['ingest.rejected'].replace('{title}', 'huge.txt').replace('{reason}', zh['ingest.reject.tooLarge']))).toBeTruthy()
  })

  it('drops one staged file without touching the rest of the batch', async () => {
    await mount(faceOf())
    await pick(fileOf('a.txt', '甲'), fileOf('b.txt', '乙'))
    await waitFor(() => { expect(screen.getByText('a.txt')).toBeTruthy() })
    const rows = screen.getAllByText(zh['ingest.drop'])
    fireEvent.click(rows[0]!)
    await waitFor(() => { expect(screen.queryByText('a.txt')).toBeNull() })
    expect(screen.getByText('b.txt')).toBeTruthy()
  })

  it('sends the batch with one source, and clears the files the index accepted', async () => {
    const ingest = vi.fn(async () => ok({ documents: [DOC], failures: [] }))
    await mount(faceOf({ ingest }))
    await pick(fileOf('manual.md', '正文'))
    await waitFor(() => { expect(screen.getByText('manual.md')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText(zh['ingest.source.placeholder']), { target: { value: '省局' } })
    fireEvent.click(screen.getByRole('button', { name: zh['ingest.submit'] }))
    await waitFor(() => { expect(screen.getByText('农业气象手册')).toBeTruthy() })
    expect(ingest).toHaveBeenCalledExactlyOnceWith([{ title: 'manual', text: '正文', source: '省局' }])
    expect(screen.queryByText('manual.md')).toBeNull()
  })

  it('indexes a batch with no source typed, sending an empty source label', async () => {
    const ingest = vi.fn(async () => ok({ documents: [DOC], failures: [] }))
    await mount(faceOf({ ingest }))
    await pick(fileOf('manual.md', '正文'))
    await waitFor(() => { expect(screen.getByText('manual.md')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh['ingest.submit'] }))
    await waitFor(() => { expect(screen.getByText('农业气象手册')).toBeTruthy() })
    expect(ingest).toHaveBeenCalledExactlyOnceWith([{ title: 'manual', text: '正文', source: '' }])
  })

  it('keeps a refused source staged so the reader can fix it and send it again', async () => {
    const refusal = { title: 'manual', code: 'CORPUS_EMPTY_DOCUMENT' as const, message: 'no text' }
    await mount(faceOf({ ingest: vi.fn(async () => ok({ documents: [], failures: [refusal] })) }))
    await pick(fileOf('manual.md', '正文'))
    await waitFor(() => { expect(screen.getByText('manual.md')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh['ingest.submit'] }))
    await waitFor(() => { expect(screen.getByText(refusalText(t, refusal))).toBeTruthy() })
    expect(screen.getByText('manual.md')).toBeTruthy()
  })

  it('reports an ingest that failed outright', async () => {
    await mount(faceOf({ ingest: vi.fn(async () => failed()) }))
    await pick(fileOf('manual.md', '正文'))
    await waitFor(() => { expect(screen.getByText('manual.md')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh['ingest.submit'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('索引失败：index is closed') })
  })
})

describe('CorpusPage document management', () => {
  it('opens a document\'s chunks by reading every ordinal, then collapses it', async () => {
    const readChunk = vi.fn(async (_docId: string, ordinal: number) => ok({ ...CHUNK, ordinal }))
    await mount(faceOf({ listDocuments: vi.fn(async () => ok([DOC])), readChunk }))
    fireEvent.click(screen.getByRole('button', { name: zh['page.inspect'] }))
    await waitFor(() => { expect(screen.getAllByText(CHUNK.text)).toHaveLength(DOC.chunkCount) })
    expect(readChunk).toHaveBeenCalledTimes(DOC.chunkCount)
    expect(readChunk).toHaveBeenNthCalledWith(1, 'doc-1', 0)
    expect(readChunk).toHaveBeenNthCalledWith(2, 'doc-1', 1)
    fireEvent.click(screen.getByRole('button', { name: zh['page.collapse'] }))
    await waitFor(() => { expect(screen.queryByText(CHUNK.text)).toBeNull() })
  })

  it('reports a chunk read the index cannot answer, and opens nothing', async () => {
    await mount(faceOf({
      listDocuments: vi.fn(async () => ok([DOC])),
      readChunk: vi.fn(async (_docId: string, ordinal: number) =>
        ordinal === 0 ? ok({ ...CHUNK, ordinal }) : failed()),
    }))
    fireEvent.click(screen.getByRole('button', { name: zh['page.inspect'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('读取分段失败：index is closed') })
    expect(screen.queryByText(CHUNK.text)).toBeNull()
  })

  it('closes an open inspection when its document is removed', async () => {
    await mount(faceOf({
      listDocuments: vi.fn(async () => ok([DOC])),
      readChunk: vi.fn(async (_docId: string, ordinal: number) => ok({ ...CHUNK, ordinal })),
    }))
    fireEvent.click(screen.getByRole('button', { name: zh['page.inspect'] }))
    await waitFor(() => { expect(screen.getAllByText(CHUNK.text)).toHaveLength(DOC.chunkCount) })
    fireEvent.click(screen.getByRole('button', { name: zh['page.remove'] }))
    await waitFor(() => { expect(screen.getByText(zh['page.empty'])).toBeTruthy() })
    expect(screen.queryByText(CHUNK.text)).toBeNull()
  })

  it('drops a removed document, and its hits, from the page', async () => {
    await mount(faceOf({
      listDocuments: vi.fn(async () => ok([DOC])),
      search: vi.fn(async () => ok({ hits: [HIT], matchExpression: '打药' })),
    }))
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '打药' } })
    fireEvent.click(screen.getByRole('button', { name: zh['search.submit'] }))
    await waitFor(() => { expect(screen.getByText(HIT.excerpt)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh['page.remove'] }))
    await waitFor(() => { expect(screen.getByText(zh['page.empty'])).toBeTruthy() })
    expect(screen.queryByText(HIT.excerpt)).toBeNull()
  })

  it('drops a removed document when no search has run', async () => {
    await mount(faceOf({ listDocuments: vi.fn(async () => ok([DOC])) }))
    fireEvent.click(screen.getByRole('button', { name: zh['page.remove'] }))
    await waitFor(() => { expect(screen.getByText(zh['page.empty'])).toBeTruthy() })
  })

  it('leaves the list alone when the index reports nothing was removed', async () => {
    const face = faceOf({
      listDocuments: vi.fn(async () => ok([DOC])),
      removeDocument: vi.fn(async () => ok({ docId: 'doc-1', removed: false })),
    })
    await mount(face)
    fireEvent.click(screen.getByRole('button', { name: zh['page.remove'] }))
    await waitFor(() => { expect(face.removeDocument).toHaveBeenCalled() })
    expect(screen.getByText('农业气象手册')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a failed removal against the list', async () => {
    await mount(faceOf({
      listDocuments: vi.fn(async () => ok([DOC])),
      removeDocument: vi.fn(async () => failed()),
    }))
    fireEvent.click(screen.getByRole('button', { name: zh['page.remove'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('读取文档列表失败：index is closed') })
  })
})

describe('CorpusPage search', () => {
  it('will not search a blank query', async () => {
    await mount(faceOf())
    const submit = screen.getByRole('button', { name: zh['search.submit'] })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '  ' } })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '打药' } })
    expect(submit).toHaveProperty('disabled', false)
  })

  it('lists hits and reads one back verbatim by its own document and ordinal', async () => {
    const search = vi.fn(async () => ok({ hits: [HIT], matchExpression: '打药' }))
    const readChunk = vi.fn(async () => ok(CHUNK))
    await mount(faceOf({ search, readChunk }))
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '打药' } })
    fireEvent.click(screen.getByRole('button', { name: zh['search.submit'] }))
    await waitFor(() => { expect(screen.getByText(HIT.excerpt)).toBeTruthy() })
    expect(search).toHaveBeenCalledExactlyOnceWith('打药')
    // React splits the trail into separate text nodes, so the range is matched
    // against the row's concatenated text rather than one node.
    expect(screen.getByText(new RegExp(hitRangeText(t, HIT)))).toBeTruthy()

    expect(screen.queryByText(CHUNK.text)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['search.open'] }))
    await waitFor(() => { expect(screen.getByText(CHUNK.text)).toBeTruthy() })
    expect(readChunk).toHaveBeenCalledExactlyOnceWith('doc-1', 4)
  })

  it('shows the read chunk under its own hit alone, naming the chunk when it has no trail', async () => {
    const other: MeteoSearchHit = { ...HIT, ordinal: 0, headingPath: '' }
    const foreign: MeteoSearchHit = { ...HIT, docId: 'doc-2', ordinal: 4, docTitle: '另一份资料' }
    await mount(faceOf({
      search: vi.fn(async () => ok({ hits: [HIT, other, foreign], matchExpression: '打药' })),
      // Echo the addressed ordinal, so the second hit reads a chunk that
      // carries no heading trail.
      readChunk: vi.fn(async (docId: string, ordinal: number) =>
        ok({ ...CHUNK, docId, ordinal, headingPath: ordinal === 0 ? '' : '第三章 施药' })),
    }))
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '打药' } })
    fireEvent.click(screen.getByRole('button', { name: zh['search.submit'] }))
    await waitFor(() => { expect(screen.getByText('另一份资料')).toBeTruthy() })
    // Three hits: the addressed one, the same document's other chunk, and a
    // different document's — only the addressed one may show the passage.
    const buttons = screen.getAllByRole('button', { name: zh['search.open'] })
    expect(buttons).toHaveLength(3)
    fireEvent.click(buttons[1]!)
    await waitFor(() => { expect(screen.getAllByText(CHUNK.text)).toHaveLength(1) })
    // The trail span also carries the range, so the label is matched by regex.
    expect(screen.getByText(new RegExp(zh['citation.label']))).toBeTruthy()
  })

  it('says the citation is gone when the index no longer holds it', async () => {
    const error = new RemoteError('meteo/chunk-not-found', 'gone', { docId: 'doc-1', ordinal: 4 }) as RemoteFailure
    await mount(faceOf({
      search: vi.fn(async () => ok({ hits: [HIT], matchExpression: '打药' })),
      readChunk: vi.fn(async () => Promise.resolve({ ok: false as const, error })),
    }))
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '打药' } })
    fireEvent.click(screen.getByRole('button', { name: zh['search.submit'] }))
    await waitFor(() => { expect(screen.getByText(HIT.excerpt)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh['search.open'] }))
    await waitFor(() => { expect(screen.getByText(zh['citation.notFound'])).toBeTruthy() })
  })

  it('reports any other evidence failure with its message', async () => {
    await mount(faceOf({
      search: vi.fn(async () => ok({ hits: [HIT], matchExpression: '打药' })),
      readChunk: vi.fn(async () => failed()),
    }))
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '打药' } })
    fireEvent.click(screen.getByRole('button', { name: zh['search.submit'] }))
    await waitFor(() => { expect(screen.getByText(HIT.excerpt)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: zh['search.open'] }))
    await waitFor(() => { expect(screen.getByText('读取引用失败：index is closed')).toBeTruthy() })
  })

  it('names the query that found nothing', async () => {
    await mount(faceOf({ search: vi.fn(async () => ok({ hits: [], matchExpression: '打药' })) }))
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '打药' } })
    fireEvent.click(screen.getByRole('button', { name: zh['search.submit'] }))
    await waitFor(() => { expect(screen.getByText(zh['search.none'].replace('{query}', '打药'))).toBeTruthy() })
  })

  it('reports a failed search', async () => {
    await mount(faceOf({ search: vi.fn(async () => failed()) }))
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: '打药' } })
    fireEvent.click(screen.getByRole('button', { name: zh['search.submit'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('检索失败：index is closed') })
  })
})

describe('corpus page copy', () => {
  it('accepts the text extensions it decodes and refuses the rest', () => {
    expect(isTextFileName('manual.MD')).toBe(true)
    expect(isTextFileName('notes.txt')).toBe(true)
    expect(isTextFileName('data.csv')).toBe(true)
    expect(isTextFileName('scan.pdf')).toBe(false)
    expect(isTextFileName('report.docx')).toBe(false)
    expect(isTextFileName('README')).toBe(false)
  })

  it('titles a document by its name without the decoded suffix', () => {
    expect(titleOfFileName('农业气象服务手册（演示）.md')).toBe('农业气象服务手册（演示）')
    expect(titleOfFileName('notes.TXT')).toBe('notes')
    // A name whose suffix is not one the page decoded keeps its whole name.
    expect(titleOfFileName('archive.tar.gz')).toBe('archive.tar.gz')
    expect(titleOfFileName('README')).toBe('README')
  })

  it('names the refused source and the code behind the refusal', () => {
    expect(refusalText(t, { title: 'A', code: 'CORPUS_EMPTY_DOCUMENT', message: '' }))
      .toBe(`A：${zh['ingest.reject.empty']}`)
    expect(refusalText(t, { title: 'B', code: 'CORPUS_DOCUMENT_TOO_LARGE', message: '' }))
      .toBe(`B：${zh['ingest.reject.tooLarge']}`)
  })

  it('names the refused pick and the page\'s own reason', () => {
    expect(stagedRefusalText(t, { name: 'scan.pdf', reason: 'binary' }))
      .toBe(`scan.pdf：${zh['ingest.reject.binary']}`)
    expect(stagedRefusalText(t, { name: 'blank.txt', reason: 'empty' }))
      .toBe(`blank.txt：${zh['ingest.reject.empty']}`)
    expect(stagedRefusalText(t, { name: 'huge.txt', reason: 'tooLarge' }))
      .toBe(`huge.txt：${zh['ingest.reject.tooLarge']}`)
  })

  it('summarizes a document by its chunks, size, source, and ingest time', () => {
    expect(documentMetaText(t, { ...DOC, chunkCount: 3, bytes: 120, ingestedAt: 0 }))
      .toBe(`3 段 · 120 字节 · 来源 省局 · 索引于 ${new Date(0).toLocaleString()}`)
    // A source is optional on the wire, so an empty one leaves no dangling label.
    expect(documentMetaText(t, { ...DOC, source: '' }))
      .toBe(`2 段 · 120 字节 · 索引于 ${new Date(0).toLocaleString()}`)
  })

  it('summarizes a hit by its character range', () => {
    expect(hitRangeText(t, HIT)).toBe('字符 120–240')
  })

  it('keeps the staging cap below the index\'s own per-document refusal', () => {
    expect(MAX_STAGED_CHARS).toBe(200_000)
  })
})

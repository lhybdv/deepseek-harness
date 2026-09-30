// @vitest-environment jsdom
/**
 * The citation body over a scripted face.
 *
 * Three answers the body must tell apart: the chunk, a citation the index no
 * longer holds, and anything else that failed. The first is the passage; the
 * second is a removal, which is answered rather than retried; the third is a
 * failure with a message the reader can act on. An address the type should never
 * have claimed is refused outright instead of being read as some other chunk.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { MeteoChunk } from '@deepseek-ai/dsh-api-meteo-controller/types'
import { citationAddress } from '../src/client/address.ts'
import { CitationTab } from '../src/client/CitationTab.tsx'
import type { CitationTabProps } from '../src/client/CitationTab.tsx'
import type { MeteoFace } from '../src/client/face.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

const CHUNK: MeteoChunk = {
  docId: 'doc-1', ordinal: 4, headingPath: '第三章 施药', charStart: 120, charEnd: 240,
  text: '打药应避开午后高温时段。',
}

const ok = <T,>(value: T): Promise<RemoteResult<T>> => Promise.resolve({ ok: true, value })
const failed = (error: RemoteFailure) => <T,>(): Promise<RemoteResult<T>> => Promise.resolve({ ok: false, error })

/** A face whose one used call is a stub. */
function faceOf(readChunk: MeteoFace['readChunk']): MeteoFace {
  return {
    listDocuments: vi.fn(async () => ok([])),
    removeDocument: vi.fn(async () => ok({ docId: 'doc-1', removed: true })),
    ingest: vi.fn(async () => ok({ documents: [], failures: [] })),
    search: vi.fn(async () => ok({ hits: [], matchExpression: 'x' })),
    readChunk,
    readFocus: vi.fn(async () => ok(null)),
  }
}

/** Render the body for one address, over the seat props the framework would supply. */
function mount(address: string, face: MeteoFace): void {
  const props = {
    useTabInfo: () => ({ tab: { contentId: address } }),
    meteo: face,
    t,
  } as unknown as CitationTabProps
  render((<CitationTab {...props} />) as ReactElement)
}

afterEach(cleanup)

describe('CitationTab', () => {
  it('reads the addressed chunk and shows it with its trail and range', async () => {
    const readChunk = vi.fn(async () => ok(CHUNK))
    mount(citationAddress('doc-1', 4), faceOf(readChunk))
    await waitFor(() => { expect(screen.getByText(CHUNK.text)).toBeTruthy() })
    expect(readChunk).toHaveBeenCalledExactlyOnceWith('doc-1', 4)
    expect(screen.getByText('第三章 施药')).toBeTruthy()
    expect(screen.getByText('字符 120–240')).toBeTruthy()
  })

  it('names the citation when the chunk carries no heading trail', async () => {
    mount(citationAddress('doc-1', 4), faceOf(vi.fn(async () => ok({ ...CHUNK, headingPath: '' }))))
    await waitFor(() => { expect(screen.getByText(zh['citation.label'])).toBeTruthy() })
  })

  it('says the citation is gone when the index no longer holds it', async () => {
    const error = new RemoteError('meteo/chunk-not-found', 'gone', { docId: 'doc-1', ordinal: 4 }) as RemoteFailure
    mount(citationAddress('doc-1', 4), faceOf(failed(error)))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh['citation.notFound']) })
  })

  it('reports any other read failure with its message', async () => {
    const error = new RemoteError('gateway/internal', 'carrier dropped', {}) as RemoteFailure
    mount(citationAddress('doc-1', 4), faceOf(failed(error)))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('读取引用失败：carrier dropped') })
  })

  it('refuses an address that is not one this type writes, without calling the index', async () => {
    const readChunk = vi.fn(async () => ok(CHUNK))
    mount('dsh-resource://meteo/citation/doc-1', faceOf(readChunk))
    expect(screen.getByText(zh['citation.noAddress'])).toBeTruthy()
    expect(readChunk).not.toHaveBeenCalled()
  })
})

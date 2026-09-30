/**
 * The bound face: one call per `meteo` method, at the wire's own arity.
 *
 * The face exists so components never hold the namespace object, so what is
 * asserted here is the forwarding — including the optional arguments that must
 * travel as `undefined` rather than be dropped.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createMeteoFace } from '../src/client/face.ts'

type MeteoRemote = Pick<ClientRemote, 'meteo'>

/** The namespace's methods as recording stubs, answering the empty value of each shape. */
function scripted(): MeteoRemote {
  return {
    meteo: {
      corpusList: vi.fn(async () => ({ ok: true, value: [] })),
      corpusRemove: vi.fn(async () => ({ ok: true, value: { docId: 'doc-1', removed: true } })),
      corpusIngest: vi.fn(async () => ({ ok: true, value: { documents: [], failures: [] } })),
      corpusSearch: vi.fn(async () => ({ ok: true, value: { hits: [], matchExpression: 'meteo' } })),
      corpusRead: vi.fn(async () => ({
        ok: true,
        value: { docId: 'doc-1', ordinal: 2, headingPath: '', charStart: 0, charEnd: 3, text: 'abc' },
      })),
      focusGet: vi.fn(async () => ({ ok: true, value: null })),
    },
  } as unknown as MeteoRemote
}

describe('createMeteoFace', () => {
  it('forwards a whole-index listing with no limit', async () => {
    const remote = scripted()
    const face = createMeteoFace(remote)
    await expect(face.listDocuments()).resolves.toEqual({ ok: true, value: [] })
    expect(remote.meteo.corpusList).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it('forwards a limited listing', async () => {
    const remote = scripted()
    await createMeteoFace(remote).listDocuments(5)
    expect(remote.meteo.corpusList).toHaveBeenCalledExactlyOnceWith(5)
  })

  it('forwards a removal by document id', async () => {
    const remote = scripted()
    await createMeteoFace(remote).removeDocument('doc-1')
    expect(remote.meteo.corpusRemove).toHaveBeenCalledExactlyOnceWith('doc-1')
  })

  it('forwards the ingest sources verbatim', async () => {
    const remote = scripted()
    const sources = [{ title: 'T', text: 'body', source: 'S' }]
    await createMeteoFace(remote).ingest(sources)
    expect(remote.meteo.corpusIngest).toHaveBeenCalledExactlyOnceWith(sources)
  })

  it('forwards a search with its optional terms and limit', async () => {
    const remote = scripted()
    await createMeteoFace(remote).search('打药行不行', ['打药'], 5)
    expect(remote.meteo.corpusSearch).toHaveBeenCalledExactlyOnceWith('打药行不行', ['打药'], 5)
  })

  it('forwards a search with neither optional argument', async () => {
    const remote = scripted()
    await createMeteoFace(remote).search('打药行不行')
    expect(remote.meteo.corpusSearch).toHaveBeenCalledExactlyOnceWith('打药行不行', undefined, undefined)
  })

  it('forwards a chunk read by document and ordinal', async () => {
    const remote = scripted()
    await createMeteoFace(remote).readChunk('doc-1', 2)
    expect(remote.meteo.corpusRead).toHaveBeenCalledExactlyOnceWith('doc-1', 2)
  })

  it('forwards the session whose focus is read', async () => {
    const remote = scripted()
    await createMeteoFace(remote).readFocus('s-1' as SessionId)
    expect(remote.meteo.focusGet).toHaveBeenCalledExactlyOnceWith('s-1')
  })
})

/**
 * The panel's asynchronous half, bound to the `meteo` Remote namespace.
 *
 * Both domains of this package read the same namespace: the corpus page
 * lists, ingests, removes, and searches; the citation tab reads one chunk
 * and its session's consultation subject. A Remote call never rejects — it
 * resolves to a `RemoteResult` and every component branches on `ok`.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  MeteoChunk, MeteoDocument, MeteoDocumentId, MeteoFocus, MeteoIngestSource, MeteoIngestValue, MeteoRemoveValue, MeteoSearchValue,
} from '@deepseek-ai/dsh-api-meteo-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The `meteo` slice of the Client Remote face, exactly as the generated client declares it. */
export type MeteoRemote = Pick<ClientRemote, 'meteo'>

/** The bound call set the page and tab bodies receive. */
export interface MeteoFace {
  /** List the indexed documents; `undefined` reads the whole index. */
  readonly listDocuments: (limit?: number) => Promise<RemoteResult<readonly MeteoDocument[]>>
  /** Remove one document from the index. */
  readonly removeDocument: (docId: MeteoDocumentId) => Promise<RemoteResult<MeteoRemoveValue>>
  /** Index the sources; the answer reports the new index and every refusal. */
  readonly ingest: (sources: readonly MeteoIngestSource[]) => Promise<RemoteResult<MeteoIngestValue>>
  /** Search the index; `terms` and `limit` narrow the match the index issues. */
  readonly search: (query: string, terms?: readonly string[], limit?: number) => Promise<RemoteResult<MeteoSearchValue>>
  /** Read one stored chunk, verbatim, by document and ordinal. */
  readonly readChunk: (docId: MeteoDocumentId, ordinal: number) => Promise<RemoteResult<MeteoChunk>>
  /** Read the session's consultation subject; `null` when none is set. */
  readonly readFocus: (sessionId: SessionId) => Promise<RemoteResult<MeteoFocus | null>>
}

/**
 * Bind the `meteo` namespace of one Remote face to the face the components call.
 * @param remote - the `meteo` slice of the Client Remote face.
 * @returns the bound call set.
 */
export function createMeteoFace(remote: MeteoRemote): MeteoFace {
  return {
    listDocuments: limit => remote.meteo.corpusList(limit),
    removeDocument: docId => remote.meteo.corpusRemove(docId),
    ingest: sources => remote.meteo.corpusIngest(sources),
    search: (query, terms, limit) => remote.meteo.corpusSearch(query, terms, limit),
    readChunk: (docId, ordinal) => remote.meteo.corpusRead(docId, ordinal),
    readFocus: sessionId => remote.meteo.focusGet(sessionId),
  }
}

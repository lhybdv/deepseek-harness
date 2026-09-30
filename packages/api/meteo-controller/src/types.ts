/**
 * Browser-safe wire vocabulary of the `meteo` Remote namespace.
 *
 * Every payload is declared here rather than re-exported from the seam that
 * produces it. A Remote boundary is compiled into the Client program, and the
 * seams are host-only — the corpus provider imports `node:sqlite`, the data
 * provider reads the filesystem — so importing their modules would drag host
 * code into the browser face. The declarations below are structurally identical
 * to the seam records, which lets the Host hand a seam record straight to a
 * Remote method while the Client sees only this module.
 *
 * @module @deepseek-ai/dsh-api-meteo-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * The addressed chunk is not in the index: the document was removed, or the
     * ordinal was never written. The panel drops that row and re-reads the list
     * rather than retrying the same address.
     */
    'meteo/chunk-not-found': {
      readonly docId: MeteoDocumentId
      readonly ordinal: number
    }
    /**
     * The deployment's meteorological data could not answer. `reason` is the
     * seam's own code, which says whether the panel is looking at a missing
     * dataset, an unreachable origin, or a query the data rejects.
     */
    'meteo/data-unavailable': {
      readonly reason: MeteoDataUnavailableReason
    }
  }
}

/** Index identity of one stored document, as the wire carries it. */
export type MeteoDocumentId = string

/** Why the deployment's data could not answer, as the wire reports it. */
export type MeteoDataUnavailableReason =
  | 'METEO_STATION_NOT_FOUND'
  | 'METEO_DATASET_UNAVAILABLE'
  | 'METEO_SOURCE_ERROR'
  | 'METEO_INVALID_QUERY'

/** One indexed document as a corpus panel lists it. */
export interface MeteoDocument {
  /** Index identity, the address every later read uses. */
  readonly docId: MeteoDocumentId
  /** Human-facing title, the label a citation carries. */
  readonly title: string
  /** Where the text came from. */
  readonly source: string
  /** UTF-8 byte length of the accepted text. */
  readonly bytes: number
  /** Chunks the document was split into. */
  readonly chunkCount: number
  /** Epoch milliseconds of the ingest. */
  readonly ingestedAt: number
}

/** One document a caller asks the namespace to index. */
export interface MeteoIngestSource {
  /** Human-facing title. */
  readonly title: string
  /** Complete document text as plain text or Markdown. */
  readonly text: string
  /** Where the text came from, shown with citations; empty when the caller has none. */
  readonly source: string
}

/** One source the index refused. */
export interface MeteoIngestFailure {
  /** The title of the source that was refused. */
  readonly title: string
  /** Stable failure code the panel switches on. */
  readonly code: 'CORPUS_EMPTY_DOCUMENT' | 'CORPUS_DOCUMENT_TOO_LARGE'
  /** Why it was refused, for display. */
  readonly message: string
}

/** What an ingest call stored and what it refused. */
export interface MeteoIngestValue {
  /** Documents now in the index. */
  readonly documents: readonly MeteoDocument[]
  /** Sources the index refused, each with its own reason. */
  readonly failures: readonly MeteoIngestFailure[]
}

/** One stored chunk, verbatim, addressed by document and ordinal. */
export interface MeteoChunk {
  /** Document the chunk belongs to. */
  readonly docId: MeteoDocumentId
  /** Zero-based position of the chunk inside its document. */
  readonly ordinal: number
  /** Heading trail above the chunk, empty when the document has no headings. */
  readonly headingPath: string
  /** Character offset of the chunk's first character in the source document. */
  readonly charStart: number
  /** Character offset one past the chunk's last character. */
  readonly charEnd: number
  /** The chunk text, exactly as the index stored it. */
  readonly text: string
}

/** Whether a removal found the document. */
export interface MeteoRemoveValue {
  /** The document the caller addressed. */
  readonly docId: MeteoDocumentId
  /** Whether a document was actually removed. */
  readonly removed: boolean
}

/** The place and crop a session is consulting about. */
export interface MeteoFocus {
  /** Station the session is consulting about, when one is set. */
  readonly stationId?: string
  /** Crop the session is consulting about, when one is set. */
  readonly crop?: string
  /** Epoch milliseconds of the last write. */
  readonly updatedAt: number
}

/** One station as the namespace publishes it. */
export interface MeteoStation {
  /** Station identity, the value a consultation's station slot takes. */
  readonly id: string
  /** Human-facing station name. */
  readonly name: string
  /** County the station sits in. */
  readonly county: string
  /** Township the station sits in. */
  readonly township: string
  /** Longitude in degrees. */
  readonly lon: number
  /** Latitude in degrees. */
  readonly lat: number
  /** Siting altitude in metres. */
  readonly altitudeM: number
}

/**
 * One retrieved chunk as a consultation panel lists it. The citation fields are
 * the ones a conclusion must quote — document, chunk ordinal, character range —
 * and `excerpt` is the capped text shown under them.
 */
export interface MeteoSearchHit {
  /** Indexed document the chunk belongs to. */
  readonly docId: MeteoDocumentId
  /** Document title, the label a citation carries. */
  readonly docTitle: string
  /** Zero-based position of the chunk inside its document. */
  readonly ordinal: number
  /** Heading trail above the chunk, empty when the document has no headings. */
  readonly headingPath: string
  /** Character offset of the chunk's first character in the source document. */
  readonly charStart: number
  /** Character offset one past the chunk's last character. */
  readonly charEnd: number
  /** Backend ranking score; lower is a better match, the index's own convention. */
  readonly score: number
  /** Chunk text with runs of whitespace collapsed, capped for one panel row. */
  readonly excerpt: string
}

/** Answer to one corpus search over the indexed documents. */
export interface MeteoSearchValue {
  /** Ranked hits, best match first. */
  readonly hits: readonly MeteoSearchHit[]
  /** The match expression the index actually issued, so an empty result can be explained. */
  readonly matchExpression: string
}

/**
 * The address one citation tab opens by.
 *
 * A right-Sidebar tab is addressed by a resource URL, so a citation is one too:
 * `dsh-resource://meteo/citation/<docId>/<ordinal>`. The document id is
 * percent-encoded as one path segment, because an id is opaque text the corpus
 * minted and may contain a `/`; the ordinal stays a decimal integer. The tab
 * type registers this pattern, so opening the address is the whole interaction —
 * no side channel carries the citation.
 *
 * @module @deepseek-ai/dsh-client-ui-meteo/address
 */
import type { MeteoDocumentId } from '@deepseek-ai/dsh-api-meteo-controller/types'

/** Address prefix every citation tab address starts with. */
export const CITATION_PREFIX = 'dsh-resource://meteo/citation/'

/** One parsed citation address: the document, and the chunk inside it. */
export interface CitationTarget {
  /** Document the citation points into. */
  readonly docId: MeteoDocumentId
  /** Zero-based chunk position inside that document. */
  readonly ordinal: number
}

/**
 * Build the address that opens one chunk in a citation tab.
 * @param docId - the document to point into.
 * @param ordinal - the zero-based chunk position.
 * @returns the resource address.
 */
export function citationAddress(docId: MeteoDocumentId, ordinal: number): string {
  return `${CITATION_PREFIX}${encodeURIComponent(docId)}/${String(ordinal)}`
}

/**
 * Read a citation address back into its document and chunk.
 * @param address - an address a citation tab was opened with.
 * @returns the target, or `null` when the address is not one this package wrote.
 */
export function parseCitationAddress(address: string): CitationTarget | null {
  if (!address.startsWith(CITATION_PREFIX)) return null
  const rest = address.slice(CITATION_PREFIX.length)
  const slash = rest.lastIndexOf('/')
  if (slash <= 0) return null
  const ordinal = Number(rest.slice(slash + 1))
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) return null
  try {
    return { docId: decodeURIComponent(rest.slice(0, slash)), ordinal }
  } catch {
    // A malformed percent sequence is not text this package encoded, so the
    // address is refused rather than repaired; the caller reports an address it
    // cannot read instead of reading a different document than the one opened.
    return null
  }
}

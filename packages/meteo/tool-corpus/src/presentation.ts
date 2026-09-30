/**
 * Shared presentation vocabulary for the corpus tools: the citation a client
 * renders without deriving anything itself, the snippet cap that keeps a cut on
 * a code-point boundary, and the narrowing that lets a presenter replay
 * metadata it did not validate on the way in.
 * @module
 */

/** One chunk a conclusion can be attributed to, as a client receives it. */
export interface CorpusCitation {
  /** Index identity to hand `corpus_read` for the verbatim chunk. */
  readonly docId: string
  /** Zero-based position of the chunk inside its document. */
  readonly ordinal: number
  /** Document title, the label a chip shows. */
  readonly docTitle: string
  /** Heading trail above the chunk; empty when the document has no headings. */
  readonly headingPath: string
  /** Character offset of the chunk's first character in the source document. */
  readonly charStart: number
  /** Character offset one past the chunk's last character. */
  readonly charEnd: number
  /** Leading excerpt of the chunk text, capped by {@link capSnippet}. */
  readonly snippet: string
}

/** `corpus_search` presentation metadata: the citation list and its window state. */
export interface CorpusSearchMeta {
  /** Retrieved chunks in result order, each with a capped excerpt. */
  readonly citations: readonly CorpusCitation[]
  /** Whether the hit list filled the requested window, so more may exist. */
  readonly truncated: boolean
}

/** `corpus_ingest` presentation metadata: what the index accepted and refused. */
export interface CorpusIngestMeta {
  /** Documents written to the index. */
  readonly indexed: number
  /** Documents the store refused, each named in {@link CorpusIngestMeta.titles}. */
  readonly rejected: number
  /** Titles of the accepted documents, in submission order. */
  readonly titles: readonly string[]
}

/** `corpus_read` presentation metadata: one chunk's coordinates and size. */
export interface CorpusReadMeta {
  /** Document the call addressed. */
  readonly docId: string
  /** Chunk position the call addressed. */
  readonly ordinal: number
  /** Whether the index held that chunk. */
  readonly found: boolean
  /** Heading trail above the chunk; empty when absent or not found. */
  readonly headingPath: string
  /** Characters in the chunk; zero when not found. */
  readonly chars: number
}

/** JSON scalar kinds the narrowing helpers accept as a required field type. */
export type MetaField = 'boolean' | 'number' | 'string'

/** Required field names mapped to the scalar kind each must carry. */
export type MetaFields = Readonly<Record<string, MetaField>>

const CITATION_FIELDS: MetaFields = {
  docId: 'string',
  ordinal: 'number',
  docTitle: 'string',
  headingPath: 'string',
  charStart: 'number',
  charEnd: 'number',
  snippet: 'string',
}

const INGEST_FIELDS: MetaFields = { indexed: 'number', rejected: 'number' }

const READ_FIELDS: MetaFields = { docId: 'string', ordinal: 'number', found: 'boolean', headingPath: 'string', chars: 'number' }

/**
 * Cut a citation excerpt to a length a chip can hold. The cut is taken on a
 * code-point boundary, so it never splits a surrogate pair into the lone
 * surrogate JSON would have to replace, and a cut excerpt is marked as one by
 * the ellipsis instead of ending mid-word at an arbitrary byte.
 * @param text - full chunk text.
 * @param maxChars - largest number of code points the excerpt may carry.
 * @returns `text` unchanged when it already fits, else its leading excerpt
 *   ending in `…` for exactly `maxChars` code points.
 */
export function capSnippet(text: string, maxChars: number): string {
  const points = Array.from(text)
  if (points.length <= maxChars) return text
  return `${points.slice(0, maxChars - 1).join('')}…`
}

/**
 * Narrow an opaque value to an object carrying every field of `fields`.
 * @param value - candidate metadata, however malformed.
 * @param fields - required field names and the scalar kind each must carry.
 * @returns the record for further reads, or `undefined` when `value` is not an
 *   object or any required field is missing or mistyped.
 */
export function narrowFields(value: unknown, fields: MetaFields): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const [key, kind] of Object.entries(fields)) {
    if (typeof record[key] !== kind) return undefined
  }
  return record
}

/**
 * Narrow an opaque value to a string list.
 * @param value - candidate metadata, however malformed.
 * @returns the strings, or `undefined` when `value` is not an array or holds a
 *   non-string element.
 */
export function narrowStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return undefined
    strings.push(item)
  }
  return strings
}

/**
 * Narrow an opaque value to a citation list.
 * @param value - candidate metadata, however malformed.
 * @returns the citations in list order, or `undefined` when `value` is not an
 *   array or any element lacks a citation field.
 */
export function narrowCitations(value: unknown): CorpusCitation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const citations: CorpusCitation[] = []
  for (const item of value) {
    const record = narrowFields(item, CITATION_FIELDS)
    if (record === undefined) return undefined
    citations.push({
      docId: record.docId as string,
      ordinal: record.ordinal as number,
      docTitle: record.docTitle as string,
      headingPath: record.headingPath as string,
      charStart: record.charStart as number,
      charEnd: record.charEnd as number,
      snippet: record.snippet as string,
    })
  }
  return citations
}

/**
 * Narrow opaque `corpus_ingest` result metadata.
 * @param meta - result metadata from a live or replayed tool result.
 * @returns the ingest counts and accepted titles, or `undefined` when malformed.
 */
export function ingestMetaFromResult(meta: unknown): CorpusIngestMeta | undefined {
  const record = narrowFields(meta, INGEST_FIELDS)
  if (record === undefined) return undefined
  const titles = narrowStrings(record.titles)
  if (titles === undefined) return undefined
  return { indexed: record.indexed as number, rejected: record.rejected as number, titles }
}

/**
 * Narrow opaque `corpus_read` result metadata.
 * @param meta - result metadata from a live or replayed tool result.
 * @returns the chunk coordinates and size, or `undefined` when malformed.
 */
export function readMetaFromResult(meta: unknown): CorpusReadMeta | undefined {
  const record = narrowFields(meta, READ_FIELDS)
  if (record === undefined) return undefined
  return {
    docId: record.docId as string,
    ordinal: record.ordinal as number,
    found: record.found as boolean,
    headingPath: record.headingPath as string,
    chars: record.chars as number,
  }
}

/**
 * Narrow opaque `corpus_search` result metadata.
 * @param meta - result metadata from a live or replayed tool result.
 * @returns the citation list and its window state, or `undefined` when malformed.
 */
export function searchMetaFromResult(meta: unknown): CorpusSearchMeta | undefined {
  const record = narrowFields(meta, { truncated: 'boolean' })
  if (record === undefined) return undefined
  const citations = narrowCitations(record.citations)
  if (citations === undefined) return undefined
  return { citations, truncated: record.truncated as boolean }
}

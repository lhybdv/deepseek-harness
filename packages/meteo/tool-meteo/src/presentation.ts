/**
 * Client-facing shapes of a meteorological consultation, and the narrowing that
 * lets a client read them back out of a replayed tool result.
 *
 * A client never parses the model-facing text. It reads `presentationMeta`: the
 * step trace that shows how the consultation was built, the citation list its
 * chips are drawn from, and the flags that tell it whether more exists. The
 * narrowing here is total — given metadata from any source, including a truncated
 * log or a foreign producer, it either returns the fields a renderer may read
 * without a guard or returns `undefined` so the client falls back to the generic
 * result view.
 *
 * @module @deepseek-ai/dsh-tool-meteo/presentation
 */

/** JSON scalar kinds the narrowing helpers accept as a required field type. */
export type MetaField = 'boolean' | 'number' | 'string'

/** Required field names mapped to the scalar kind each must carry. */
export type MetaFields = Readonly<Record<string, MetaField>>

/** One pipeline step, as a client receives it. */
export interface ConsultStepMeta {
  /** Pipeline step: `slots`, `observation`, `forecast`, `suitability`, `hazard`, or `corpus`. */
  readonly step: string
  /** How the step ended: `done`, `unknown`, or `skipped`. */
  readonly status: string
  /** One-line account of what the step read and concluded, derived from its records. */
  readonly detail: string
  /** Records the step produced; zero for a step that ran and found nothing. */
  readonly count: number
}

/** One chunk a conclusion can be attributed to, as a client receives it. */
export interface ConsultCitationMeta {
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

/** The consultation fields a renderer may read without a guard. */
export interface ConsultViewMeta {
  /** Which slots the consultation was asked with. */
  readonly intent: string
  /** Pipeline trace, in the order the steps ran. */
  readonly steps: readonly ConsultStepMeta[]
  /** Retrieved chunks in result order, each with a capped excerpt. */
  readonly citations: readonly ConsultCitationMeta[]
  /** Whether the chunk list filled the retrieval window, so more may exist. */
  readonly truncated: boolean
}

const STEP_FIELDS: MetaFields = { step: 'string', status: 'string', detail: 'string', count: 'number' }

const CITATION_FIELDS: MetaFields = {
  docId: 'string',
  ordinal: 'number',
  docTitle: 'string',
  headingPath: 'string',
  charStart: 'number',
  charEnd: 'number',
  snippet: 'string',
}

/**
 * Cut a citation excerpt to a length a chip can hold. The cut is taken on a
 * code-point boundary, so it never splits a surrogate pair into the lone
 * surrogate JSON would have to replace.
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
 * Narrow an opaque value to a list of records that each carry `fields`.
 * @param value - candidate metadata, however malformed.
 * @param fields - required field names and the scalar kind each element must carry.
 * @returns the records in list order, or `undefined` when `value` is not an array
 *   or any element lacks one of the fields.
 */
export function narrowRecords(value: unknown, fields: MetaFields): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined
  const records: Record<string, unknown>[] = []
  for (const item of value) {
    const record = narrowFields(item, fields)
    if (record === undefined) return undefined
    records.push(record)
  }
  return records
}

/**
 * Narrow result metadata to the record list stored under one key.
 * @param meta - result metadata from a live or replayed tool result.
 * @param key - the metadata field that carries the list.
 * @param fields - required field names and the scalar kind each element must carry.
 * @returns the records in list order, or `undefined` when `meta` is not an object,
 *   or the list it names is missing or malformed.
 */
export function narrowRecordList(meta: unknown, key: string, fields: MetaFields): Record<string, unknown>[] | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const record = meta as Record<string, unknown>
  return narrowRecords(record[key], fields)
}

/**
 * Narrow opaque `meteo_consult` result metadata into what a renderer reads.
 * @param meta - result metadata from a live or replayed tool result.
 * @returns the intent, trace, citation list, and window state, or `undefined`
 *   when any of them is malformed.
 */
export function consultViewFromResult(meta: unknown): ConsultViewMeta | undefined {
  const record = narrowFields(meta, { intent: 'string', truncated: 'boolean' })
  if (record === undefined) return undefined
  const steps = narrowRecords(record.steps, STEP_FIELDS)
  if (steps === undefined) return undefined
  const citations = narrowRecords(record.citations, CITATION_FIELDS)
  if (citations === undefined) return undefined
  return {
    intent: record.intent as string,
    truncated: record.truncated as boolean,
    steps: steps.map(step => ({
      step: step.step as string,
      status: step.status as string,
      detail: step.detail as string,
      count: step.count as number,
    })),
    citations: citations.map(citation => ({
      docId: citation.docId as string,
      ordinal: citation.ordinal as number,
      docTitle: citation.docTitle as string,
      headingPath: citation.headingPath as string,
      charStart: citation.charStart as number,
      charEnd: citation.charEnd as number,
      snippet: citation.snippet as string,
    })),
  }
}

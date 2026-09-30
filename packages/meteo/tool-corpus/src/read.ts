/**
 * The model-facing `corpus_read` tool: reopen one chunk verbatim by the document
 * identity and chunk ordinal a retrieval reported. A chunk is an excerpt, and the
 * excerpt the model already has is the one `corpus_search` chose to show, so this
 * tool exists to settle what the whole chunk actually says.
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { CorpusDocumentId } from '@deepseek-ai/dsh-meteo-corpus'
import type { CorpusLimits } from './config.ts'
import { readMetaFromResult } from './presentation.ts'

/** One chunk as the index holds it. */
export interface CorpusChunkValue {
  /** Heading trail above the chunk; empty when the document has no headings. */
  headingPath: string
  /** Character offset of the chunk's first character in the source document. */
  charStart: number
  /** Character offset one past the chunk's last character. */
  charEnd: number
  /** Chunk text, verbatim. */
  text: string
}

/** Canonical `corpus_read` output value. */
export interface CorpusReadOutput {
  /** Document the call addressed. */
  docId: string
  /** Chunk position the call addressed. */
  ordinal: number
  /** Whether the index held that chunk; the canonical form of a miss. */
  found: boolean
  /** The chunk itself, absent exactly when `found` is false. */
  chunk?: CorpusChunkValue
}

/** Model-facing `corpus_read` arguments. */
interface CorpusReadArgs {
  docId: string
  ordinal: number
}

/**
 * Format a read outcome as the model-facing text block: the chunk with its
 * citation coordinates, or a plain statement that no such chunk exists.
 * @param value - the canonical read output.
 * @returns the rendered chunk or the miss notice.
 */
export function formatReadOutput(value: CorpusReadOutput): string {
  const chunk = value.chunk
  if (chunk === undefined) {
    return `Document ${value.docId} has no chunk ${value.ordinal}.`
      + ' Run corpus_search again for a docId and chunk ordinal the index holds now.'
  }
  const heading = chunk.headingPath.length === 0 ? '' : ` | heading ${chunk.headingPath}`
  return `Chunk ${value.ordinal} of document ${value.docId} | chars ${chunk.charStart}-${chunk.charEnd}${heading}\n\n${chunk.text}`
}

/**
 * Project a validated read outcome into its replayable presentation meta.
 * @param value - the canonical read output.
 * @returns the chunk coordinates and size, with an empty trail and zero size on a miss.
 */
export function readMetaFromValue(value: CorpusReadOutput): JsonValue {
  const chunk = value.chunk
  if (chunk === undefined) {
    return { docId: value.docId, ordinal: value.ordinal, found: false, headingPath: '', chars: 0 }
  }
  return {
    docId: value.docId,
    ordinal: value.ordinal,
    found: true,
    headingPath: chunk.headingPath,
    chars: chunk.charEnd - chunk.charStart,
  }
}

/**
 * Pending-call presentation: a read card naming the chunk being reopened.
 * @param args - the raw tool arguments.
 * @returns the generic card view (`kind: 'read'`) shown while the call runs.
 */
export function presentReadCall(args: CorpusReadArgs): GenericCallView {
  return {
    card: 'generic',
    title: `Read chunk ${args.ordinal} of ${args.docId}`,
    kind: 'read',
    rawInput: { docId: args.docId, ordinal: args.ordinal },
  }
}

/**
 * Completed-call presentation: a compact card carrying the chunk's coordinates
 * from `meta`, without the text the model already received.
 * @param result - the final model-facing tool result; `meta` carries the coordinates.
 * @returns the generic result view, or `undefined` (generic fallback) on failure
 *   or malformed meta.
 */
export function presentReadResult(result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = readMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  if (!meta.found) return { card: 'generic', title: `No chunk ${meta.ordinal} in ${meta.docId}` }
  return {
    card: 'generic',
    title: `Read ${meta.chars} characters (chunk ${meta.ordinal})`,
    ...(meta.headingPath.length === 0 ? {} : {
      content: [{ type: 'text' as const, text: meta.headingPath }],
    }),
  }
}

/**
 * Register the `corpus_read` tool.
 * @param ctx - context whose `tools` registry receives the definition; it is
 *   effect-scoped, so the tool unregisters when the plugin disposes.
 * @param limits - the deployment's tool-call budget.
 */
export function applyCorpusReadTool(ctx: Context, limits: CorpusLimits): void {
  ctx.tools.register(defineTool({
    name: 'corpus_read',
    description: 'Read one corpus chunk verbatim, by the docId and chunk ordinal a corpus_search hit reported. Use it when a retrieved excerpt is not enough; the chunk comes back whole with its character range.',
    parameters: {
      docId: { type: 'string', required: true, description: 'Document identity, exactly as a corpus_search hit or corpus_ingest result gave it.' },
      ordinal: { type: 'integer', required: true, description: 'Chunk position within that document, zero-based.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          docId: { type: 'string', required: true },
          ordinal: { type: 'integer', required: true },
          found: { type: 'boolean', required: true },
          chunk: {
            type: 'object',
            additionalProperties: false,
            properties: {
              headingPath: { type: 'string', required: true },
              charStart: { type: 'integer', required: true },
              charEnd: { type: 'integer', required: true },
              text: { type: 'string', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatReadOutput(value) }],
      presentationMeta: (_args, value) => readMetaFromValue(value),
    },
    timeoutMs: limits.timeoutMs,
    // Reading one chunk writes nothing.
    isConcurrencySafe: () => true,
    async execute(args) {
      const docId = args.docId.trim()
      if (docId.length === 0) throw new Error('docId must be a non-empty string')
      if (args.ordinal < 0) throw new Error('ordinal must be zero or a positive integer')
      const chunk = await ctx.corpus.readChunk(brandString<CorpusDocumentId>(docId), args.ordinal)
      if (chunk === undefined) return { docId, ordinal: args.ordinal, found: false }
      return {
        docId,
        ordinal: args.ordinal,
        found: true,
        chunk: {
          headingPath: chunk.headingPath,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          text: chunk.text,
        },
      }
    },
    presentCall: presentReadCall,
    presentResult: (_args, result) => presentReadResult(result),
  }))
}

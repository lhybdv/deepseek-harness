/**
 * The model-facing `corpus_ingest` tool: put a document into the deployment's
 * retrieval corpus so `corpus_search` can answer from it. This module owns the
 * schema, the per-call batch bounds, the model-facing summary, and the
 * replayable presentation meta; chunking, identity, and every per-document
 * decision belong to `ctx.corpus`.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { CorpusLimits } from './config.ts'
import { ingestMetaFromResult } from './presentation.ts'

/** One document the index accepted, with what the index made of it. */
export interface CorpusIngestedDocument {
  /** Index identity to cite and to hand `corpus_read`. */
  docId: string
  /** Title as submitted. */
  title: string
  /** Provenance as submitted; empty when the caller gave none. */
  source: string
  /** UTF-8 byte length of the accepted text. */
  bytes: number
  /** Chunks the store wrote for this document. */
  chunkCount: number
}

/** One document the store refused, named by its submitted title. */
export interface CorpusIngestFailure {
  /** Title as submitted. */
  title: string
  /** Stable store code, e.g. `CORPUS_EMPTY_DOCUMENT`. */
  code: string
  /** Store explanation, safe to show the model. */
  message: string
}

/** Canonical `corpus_ingest` output value. */
export interface CorpusIngestOutput {
  /** Accepted documents, in submission order. */
  documents: CorpusIngestedDocument[]
  /** Refused documents, in submission order; a refusal never aborts the batch. */
  failures: CorpusIngestFailure[]
}

/** Model-facing `corpus_ingest` arguments. */
interface CorpusIngestArgs {
  documents: { title: string; text: string; source?: string }[]
}

/**
 * Format an ingest outcome as the one model-facing text block: what reached the
 * index with its chunk and byte counts, then what the store refused and why.
 * @param value - the canonical ingest output.
 * @returns the summary lines, accepted documents first.
 */
export function formatIngestOutput(value: CorpusIngestOutput): string {
  const chunks = value.documents.reduce((total, doc) => total + doc.chunkCount, 0)
  const bytes = value.documents.reduce((total, doc) => total + doc.bytes, 0)
  const lines = [value.documents.length === 0
    ? 'Indexed 0 documents.'
    : `Indexed ${value.documents.length} documents: ${chunks} chunks, ${bytes} bytes.`]
  for (const doc of value.documents) {
    lines.push(`- ${doc.docId} | ${doc.title} | chunks ${doc.chunkCount} | bytes ${doc.bytes}`
      + (doc.source.length === 0 ? '' : ` | source ${doc.source}`))
  }
  if (value.failures.length > 0) {
    lines.push(`Rejected documents (${value.failures.length}):`)
    for (const failure of value.failures) {
      lines.push(`- ${failure.title} | ${failure.code}: ${failure.message}`)
    }
  }
  return lines.join('\n')
}

/**
 * Project a validated ingest value into its replayable presentation meta.
 * @param value - the canonical ingest output.
 * @returns the accepted and refused counts plus the accepted titles.
 */
export function ingestMetaFromValue(value: CorpusIngestOutput): JsonValue {
  return {
    indexed: value.documents.length,
    rejected: value.failures.length,
    titles: value.documents.map(doc => doc.title),
  }
}

/**
 * Pending-call presentation: an edit card titled by the documents being indexed.
 * @param args - the raw tool arguments; only their titles feed the view.
 * @returns the generic card view (`kind: 'edit'`) shown while the call runs.
 */
export function presentIngestCall(args: CorpusIngestArgs): GenericCallView {
  const titles = args.documents.map(doc => doc.title).join(', ')
  return {
    card: 'generic',
    title: `Index ${args.documents.length} document(s): ${titles}`,
    kind: 'edit',
    rawInput: titles,
  }
}

/**
 * Completed-call presentation: a compact card carrying the counts and accepted
 * titles from `meta`, so a replay shows what the index holds now.
 * @param result - the final model-facing tool result; `meta` carries the outcome.
 * @returns the generic result view, or `undefined` (generic fallback) on failure
 *   or malformed meta.
 */
export function presentIngestResult(result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = ingestMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  return {
    card: 'generic',
    title: `Indexed ${meta.indexed} of ${meta.indexed + meta.rejected} documents`,
    ...(meta.titles.length === 0 ? {} : { content: [{ type: 'text' as const, text: meta.titles.map(title => `- ${title}`).join('\n') }] }),
  }
}

/**
 * Validate the batch shape the schema DSL cannot express, then hand the sources
 * to the corpus seam. Per-document validity is the store's decision: a refused
 * document comes back in `failures` instead of aborting the call.
 * @param limits - the deployment's ingest bounds.
 * @param documents - schema-validated documents.
 * @returns the sources as the seam receives them, with provenance filled in.
 */
function toIngestSources(limits: CorpusLimits, documents: CorpusIngestArgs['documents']): { title: string; text: string; source: string }[] {
  if (documents.length === 0) throw new Error('documents must contain at least one document')
  if (documents.length > limits.maxIngestDocuments) {
    throw new Error(`documents must contain at most ${limits.maxIngestDocuments} documents`)
  }
  const chars = documents.reduce((total, doc) => total + doc.text.length, 0)
  if (chars > limits.maxIngestChars) {
    throw new Error(`documents must contain at most ${limits.maxIngestChars} characters in total, got ${chars}`)
  }
  return documents.map(doc => ({ title: doc.title, text: doc.text, source: doc.source ?? '' }))
}

/**
 * Register the `corpus_ingest` tool.
 * @param ctx - context whose `tools` registry receives the definition; it is
 *   effect-scoped, so the tool unregisters when the plugin disposes.
 * @param limits - the deployment's ingest bounds and tool-call budget.
 */
export function applyCorpusIngestTool(ctx: Context, limits: CorpusLimits): void {
  ctx.tools.register(defineTool({
    name: 'corpus_ingest',
    description: `Index documents into the deployment's retrieval corpus so corpus_search can answer from them. Provide 1-${limits.maxIngestDocuments} documents per call and ${limits.maxIngestChars} characters at most across them. Each accepted document is split into citable chunks.`,
    parameters: {
      documents: {
        type: 'array',
        required: true,
        description: `Documents to index; 1-${limits.maxIngestDocuments} per call.`,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: 'Document title; the label retrieval results and citations show.' },
            text: { type: 'string', required: true, description: 'Complete document text as plain text or Markdown.' },
            source: { type: 'string', description: 'Where the text came from (a filename, an uploader note); shown with citations.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          documents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                docId: { type: 'string', required: true },
                title: { type: 'string', required: true },
                source: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                chunkCount: { type: 'integer', required: true },
              },
            },
          },
          failures: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatIngestOutput(value) }],
      presentationMeta: (_args, value) => ingestMetaFromValue(value),
    },
    timeoutMs: limits.timeoutMs,
    async execute(args) {
      const result = await ctx.corpus.ingest({ sources: toIngestSources(limits, args.documents) })
      return {
        documents: result.documents.map(doc => ({
          docId: doc.docId,
          title: doc.title,
          source: doc.source,
          bytes: doc.bytes,
          chunkCount: doc.chunkCount,
        })),
        failures: result.failures.map(failure => ({
          title: failure.title,
          code: failure.code,
          message: failure.message,
        })),
      }
    },
    presentCall: presentIngestCall,
    presentResult: (_args, result) => presentIngestResult(result),
  }))
}

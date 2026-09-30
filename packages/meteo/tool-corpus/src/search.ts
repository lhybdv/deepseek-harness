/**
 * The model-facing `corpus_search` tool: ask the deployment's ingested corpus a
 * question and get the chunks that answer it, ranked. This module owns the
 * schema, the argument rules the schema DSL cannot state, the retrieval limit
 * policy, the model-facing rendering, and the citation list a client renders as
 * chips; tokenization, ranking, and the index belong to `ctx.corpus`.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { CorpusLimits } from './config.ts'
import { capSnippet, searchMetaFromResult } from './presentation.ts'

/** One retrieved chunk, as the model and the canonical value see it. */
export interface CorpusSearchHit {
  /** Index identity to hand `corpus_read` for the verbatim chunk. */
  docId: string
  /** Zero-based position of the chunk inside its document. */
  ordinal: number
  /** Title of the document the chunk came from. */
  docTitle: string
  /** Heading trail above the chunk; empty when the document has no headings. */
  headingPath: string
  /** Character offset of the chunk's first character in the source document. */
  charStart: number
  /** Character offset one past the chunk's last character. */
  charEnd: number
  /** Chunk text as stored, verbatim. */
  text: string
}

/** Canonical `corpus_search` output value. */
export interface CorpusSearchOutput {
  /** Retrieved chunks, most relevant first. */
  hits: CorpusSearchHit[]
  /** The index expression actually issued, for diagnosis and replay. */
  matchExpression: string
  /** Whether nothing matched; the canonical form of an empty retrieval. */
  empty: boolean
  /** Whether the hits filled the requested window, so more may exist. */
  truncated: boolean
}

/** Model-facing `corpus_search` arguments. */
interface CorpusSearchArgs {
  query: string
  terms?: string[]
  limit?: number
}

/**
 * Format a retrieval as the model-facing text block: a count line, each chunk
 * with its citation coordinates and verbatim text, a refine note when the
 * window was filled, and the standing citation rule.
 * @param value - the canonical search output.
 * @returns the rendered blocks, joined by blank lines.
 */
export function formatSearchOutput(value: CorpusSearchOutput): string {
  if (value.empty) {
    return 'No chunk matched. Search again with broader terms, or index the document with corpus_ingest.'
  }
  const parts = [`Matched ${value.hits.length} chunks (most relevant first).`]
  for (const [index, hit] of value.hits.entries()) {
    const heading = hit.headingPath.length === 0 ? '' : ` | heading ${hit.headingPath}`
    parts.push(`[${index + 1}] ${hit.docTitle} | docId ${hit.docId} | chunk ${hit.ordinal}`
      + ` | chars ${hit.charStart}-${hit.charEnd}${heading}\n${hit.text}`)
  }
  if (value.truncated) {
    parts.push(`(Showing the first ${value.hits.length} matches; the corpus may hold more.`
      + ' Narrow the question, change the terms, or raise limit.)')
  }
  parts.push('Every conclusion drawn from these chunks must cite its document title,'
    + ' chunk ordinal, and character range. Call corpus_read with a docId and chunk ordinal to reopen one verbatim.')
  return parts.join('\n\n')
}

/**
 * Project a validated retrieval into its replayable presentation meta: the
 * citation list a client renders as chips, each carrying the chunk's identity,
 * position, and a capped excerpt, so nothing is derived from the lossy render text.
 * @param value - the canonical search output.
 * @param maxSnippetChars - the deployment's excerpt cap in code points.
 * @returns the citations in result order and the window state.
 */
export function searchMetaFromValue(value: CorpusSearchOutput, maxSnippetChars: number): JsonValue {
  return {
    citations: value.hits.map(hit => ({
      docId: hit.docId,
      ordinal: hit.ordinal,
      docTitle: hit.docTitle,
      headingPath: hit.headingPath,
      charStart: hit.charStart,
      charEnd: hit.charEnd,
      snippet: capSnippet(hit.text, maxSnippetChars),
    })),
    truncated: value.truncated,
  }
}

/**
 * Pending-call presentation: a search card titled by the question.
 * @param args - the raw tool arguments; only the question feeds the view.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
export function presentSearchCall(args: CorpusSearchArgs): GenericCallView {
  return { card: 'generic', title: args.query, kind: 'search', rawInput: args.query }
}

/**
 * Completed-call presentation: a compact citation list from `meta`, without the
 * chunk texts the model already has.
 * @param args - the raw tool arguments; the question titles the card so a
 *   window-truncated replay that dropped the call head still shows what was asked.
 * @param result - the final model-facing tool result; `meta` carries the citations.
 * @returns the generic result view, or `undefined` (generic fallback) on failure
 *   or malformed meta.
 */
export function presentSearchResult(args: CorpusSearchArgs, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  const meta = searchMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  const lines = meta.citations.map(citation => `- ${citation.docTitle} | chunk ${citation.ordinal}`
    + ` | chars ${citation.charStart}-${citation.charEnd}`)
  return {
    card: 'generic',
    title: args.query,
    ...(lines.length === 0 ? {} : { content: [{ type: 'text' as const, text: lines.join('\n') }] }),
  }
}

/**
 * Register the `corpus_search` tool.
 * @param ctx - context whose `tools` registry receives the definition; it is
 *   effect-scoped, so the tool unregisters when the plugin disposes.
 * @param limits - the deployment's retrieval, citation, and timeout bounds.
 */
export function applyCorpusSearchTool(ctx: Context, limits: CorpusLimits): void {
  ctx.tools.register(defineTool({
    name: 'corpus_search',
    description: `Search the deployment's ingested corpus for the chunks that answer a question. Pass the question as query plus terms you derive from it (disaster type, crop, activity, weather element); recall unions those with the question's own words. Returns at most limit chunks (default ${limits.defaultLimit}, ${limits.maxLimit} at the most), most relevant first, each with its document title, chunk ordinal, character range, and text.`,
    parameters: {
      query: { type: 'string', required: true, description: "The question, in the caller's own words." },
      terms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Domain terms derived from the question, including synonyms; recall unions them with the question.',
      },
      limit: { type: 'integer', description: `Chunks to return, 1-${limits.maxLimit}. Defaults to ${limits.defaultLimit}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                docId: { type: 'string', required: true },
                ordinal: { type: 'integer', required: true },
                docTitle: { type: 'string', required: true },
                headingPath: { type: 'string', required: true },
                charStart: { type: 'integer', required: true },
                charEnd: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          matchExpression: { type: 'string', required: true },
          empty: { type: 'boolean', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSearchOutput(value) }],
      presentationMeta: (_args, value) => searchMetaFromValue(value, limits.maxSnippetChars),
    },
    timeoutMs: limits.timeoutMs,
    // Retrieval reads the index and writes nothing.
    isConcurrencySafe: () => true,
    async execute(args) {
      const query = args.query.trim()
      if (query.length === 0) throw new Error('query must be a non-empty string')
      const terms = args.terms ?? []
      if (terms.some(term => term.trim().length === 0)) throw new Error('each term must be a non-empty string')
      const limit = args.limit ?? limits.defaultLimit
      if (limit < 1 || limit > limits.maxLimit) {
        throw new Error(`limit must be between 1 and ${limits.maxLimit}`)
      }
      const result = await ctx.corpus.search({ query, terms, limit })
      return {
        hits: result.hits.map(hit => ({
          docId: hit.docId,
          ordinal: hit.ordinal,
          docTitle: hit.docTitle,
          headingPath: hit.headingPath,
          charStart: hit.charStart,
          charEnd: hit.charEnd,
          text: hit.text,
        })),
        matchExpression: result.matchExpression,
        empty: result.hits.length === 0,
        truncated: result.hits.length === limit,
      }
    },
    presentCall: presentSearchCall,
    presentResult: presentSearchResult,
  }))
}

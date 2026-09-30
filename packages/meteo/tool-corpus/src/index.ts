/**
 * Model-facing corpus tools over the harness corpus seam: `corpus_ingest` puts
 * professional text into the deployment's index, `corpus_search` retrieves the
 * chunks that answer a question, and `corpus_read` reopens one chunk verbatim.
 *
 * @module @deepseek-ai/dsh-tool-corpus
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertCorpusLimits, Config, type CorpusLimits } from './config.ts'
import { applyCorpusIngestTool } from './ingest.ts'
import { applyCorpusReadTool } from './read.ts'
import { applyCorpusSearchTool } from './search.ts'

export { Config }
export type { CorpusLimits }
export {
  DEFAULT_MAX_INGEST_CHARS,
  DEFAULT_MAX_INGEST_DOCUMENTS,
  DEFAULT_MAX_SEARCH_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SNIPPET_CHARS,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './config.ts'
export { assertCorpusLimits } from './config.ts'
export { formatIngestOutput, ingestMetaFromValue, presentIngestCall, presentIngestResult } from './ingest.ts'
export type { CorpusIngestFailure, CorpusIngestOutput, CorpusIngestedDocument } from './ingest.ts'
export { capSnippet, ingestMetaFromResult, readMetaFromResult, searchMetaFromResult } from './presentation.ts'
export type { CorpusCitation, CorpusIngestMeta, CorpusReadMeta, CorpusSearchMeta } from './presentation.ts'
export { formatReadOutput, presentReadCall, presentReadResult, readMetaFromValue } from './read.ts'
export type { CorpusChunkValue, CorpusReadOutput } from './read.ts'
export { formatSearchOutput, presentSearchCall, presentSearchResult, searchMetaFromValue } from './search.ts'
export type { CorpusSearchHit, CorpusSearchOutput } from './search.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-corpus'

/** Capability services the model-facing consumer needs. */
export const inject = ['tools', 'corpus', 'systemPrompt']

/**
 * Register the three corpus tools and the guidance that tells the model when to
 * use them. Config defaults are deployment policy: the retrieval window, the
 * citation excerpt length, the ingest batch size, and the cooperative tool-call
 * budget are never model arguments. Each tool carries `timeoutMs` for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce, and every registration
 * is effect-scoped, so disposing the plugin removes all three tools and the
 * prompt section without manual teardown.
 * @param ctx - context whose `tools`, `corpus`, and `systemPrompt` services are used.
 * @param config - deployment bounds, with every defaulted field filled in by schemastery.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const limits = config as CorpusLimits
  assertCorpusLimits(limits)
  ctx.systemPrompt.section({
    name: 'tool:corpus',
    order: ctx.systemPrompt.getSectionOrder('TOOL_METEO_CORPUS'),
    text: ({ scope }) => ctx.tools.get('corpus_search', scope) === undefined ? '' : corpusGuidance(limits),
  })
  applyCorpusIngestTool(ctx, limits)
  applyCorpusSearchTool(ctx, limits)
  applyCorpusReadTool(ctx, limits)
}

/**
 * The standing guidance the model reads before its first corpus call. It states
 * the derived-term contract that carries a colloquial question past the words a
 * professional corpus does not contain, the bounds the model may ask within, and
 * the citation obligation every retrieved chunk carries.
 * @param limits - the resolved bounds, because the text names the real numbers.
 * @returns the prompt text of the `tool:corpus` section.
 */
export function corpusGuidance(limits: CorpusLimits): string {
  return 'Use corpus_search when an answer must come from documents indexed by this deployment: pass the question '
    + 'as query and add the terms you derive from it (disaster type, crop, activity, weather element), because '
    + `recall unions both. It returns ${limits.defaultLimit} chunks by default and ${limits.maxLimit} at the most, `
    + 'ranked, each with a document title, a chunk ordinal, and a character range. A chunk is an excerpt: when an '
    + 'excerpt is not enough, call corpus_read with the docId and ordinal of that hit to reopen the whole chunk. '
    + 'Every conclusion drawn from a chunk must cite the document title, the chunk ordinal, and the character range. '
    + 'When nothing matches, say the indexed documents do not cover the question instead of inventing a citation. '
    + `Index new documents with corpus_ingest, at most ${limits.maxIngestDocuments} documents and `
    + `${limits.maxIngestChars} characters in total per call.`
}

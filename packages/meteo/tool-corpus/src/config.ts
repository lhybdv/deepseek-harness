/**
 * Plugin configuration for the corpus tools: every bound the model may not
 * choose for itself, plus the cooperative tool-call budget the deployment owns.
 * @module
 */

import z from '@deepseek-ai/schemastery'

/** Chunks one `corpus_search` call returns when the model omits `limit`. */
export const DEFAULT_SEARCH_LIMIT = 8

/** Largest `limit` a model may ask `corpus_search` for. */
export const DEFAULT_MAX_SEARCH_LIMIT = 20

/** Longest citation snippet `corpus_search` hands a client, in code points. */
export const DEFAULT_SNIPPET_CHARS = 280

/** Documents one `corpus_ingest` call may submit. */
export const DEFAULT_MAX_INGEST_DOCUMENTS = 10

/** Total characters one `corpus_ingest` call may submit across all documents. */
export const DEFAULT_MAX_INGEST_CHARS = 200_000

/** Cooperative tool-call budget (ms) attached to every corpus tool. */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000

/** Plugin config: retrieval, citation, ingest, and timeout bounds. */
export interface Config {
  /** Chunks returned by one `corpus_search` call that omits `limit`. Defaults to 8. */
  defaultLimit?: number
  /** Largest `limit` `corpus_search` accepts; larger requests are rejected. Defaults to 20. */
  maxLimit?: number
  /** Citation snippet cap in code points. Defaults to 280. */
  maxSnippetChars?: number
  /** Documents accepted by one `corpus_ingest` call. Defaults to 10. */
  maxIngestDocuments?: number
  /** Characters accepted by one `corpus_ingest` call across all its documents. Defaults to 200000. */
  maxIngestChars?: number
  /** Cooperative tool-call budget (ms) for all three tools. Defaults to 30000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  defaultLimit: z.number().default(DEFAULT_SEARCH_LIMIT),
  maxLimit: z.number().default(DEFAULT_MAX_SEARCH_LIMIT),
  maxSnippetChars: z.number().default(DEFAULT_SNIPPET_CHARS),
  maxIngestDocuments: z.number().default(DEFAULT_MAX_INGEST_DOCUMENTS),
  maxIngestChars: z.number().default(DEFAULT_MAX_INGEST_CHARS),
  timeoutMs: z.number().default(DEFAULT_TOOL_TIMEOUT_MS),
})

/** Every bound after schemastery has applied each field default. */
export type CorpusLimits = Required<Config>

/**
 * Validate the resolved bounds before any tool is registered, so a
 * misconfigured deployment fails at load instead of at the first tool call.
 * @param limits - config with every field default filled in.
 */
export function assertCorpusLimits(limits: CorpusLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`tool-corpus: ${name} must be a positive integer`)
    }
  }
  if (limits.defaultLimit > limits.maxLimit) {
    throw new Error('tool-corpus: defaultLimit must not exceed maxLimit')
  }
}

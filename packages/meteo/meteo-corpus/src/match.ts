/**
 * FTS5 MATCH construction for corpus recall.
 *
 * Recall unions every token of the question with every token of the caller's
 * expansion terms and ORs them. OR is load-bearing: AND-joining a colloquial
 * question drops the whole result set as soon as one of its words is absent
 * from the corpus ("行不行", "咋办" are absent from any professional corpus), so
 * AND returns nothing at all while OR still ranks the documents that do match.
 *
 * @module @deepseek-ai/dsh-meteo-corpus/match
 */

import { bigrams } from './text.ts'

/**
 * Build the MATCH expression for one search.
 *
 * Tokens are taken from `query` first, so when the token budget truncates the
 * expression the question's own subject survives and the expansion terms are
 * what get dropped.
 *
 * Every emitted token is a Han run or an alphanumeric run — {@link bigrams}
 * admits nothing else — so a token can never contain a double quote, a
 * wildcard, or an FTS5 operator, and the quoting below is structural rather
 * than an escape.
 *
 * @param query - the user-facing question.
 * @param terms - caller-derived expansion terms joined into the same OR.
 * @param maxTokens - upper bound on distinct tokens; bounds MATCH size and cost.
 * @returns the MATCH expression, or an empty string when nothing tokenizes.
 */
export function buildMatchExpression(query: string, terms: readonly string[], maxTokens: number): string {
  const tokens = new Set<string>()
  for (const source of [query, ...terms]) {
    for (const token of bigrams(source)) {
      if (tokens.size >= maxTokens) break
      tokens.add(token)
    }
  }
  return [...tokens].map(token => `"${token}"`).join(' OR ')
}

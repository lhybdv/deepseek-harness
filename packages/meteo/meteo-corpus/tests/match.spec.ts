/**
 * Tests for MATCH construction: the OR union that keeps a colloquial question
 * from collapsing to an empty result set, and the token budget that bounds it.
 */

import { describe, expect, it } from 'vitest'
import { buildMatchExpression } from '@deepseek-ai/dsh-meteo-corpus'

describe('buildMatchExpression', () => {
  it('returns an empty expression when nothing tokenizes', () => {
    expect(buildMatchExpression('???', [], 64)).toBe('')
  })

  it('quotes every token of the question', () => {
    expect(buildMatchExpression('风速', [], 64)).toBe('"风速"')
  })

  it('unions expansion terms into the same OR', () => {
    expect(buildMatchExpression('打药', ['施药'], 64)).toBe('"打药" OR "施药"')
  })

  it('deduplicates tokens shared by the question and a term', () => {
    expect(buildMatchExpression('打药', ['打药'], 64)).toBe('"打药"')
  })

  it('never joins with AND, which would drop the corpus for one absent word', () => {
    expect(buildMatchExpression('打药合适吗', [], 64)).not.toContain('AND')
  })

  it('keeps the question first so truncation drops expansion terms, not its subject', () => {
    const expression = buildMatchExpression('风速', ['打药', '施药', '喷药'], 1)
    expect(expression).toBe('"风速"')
  })
})

/** Reciprocal-rank fusion and cosine similarity behavior. */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { cosineSimilarity, fuseRanks, type CorpusDocumentId, type CorpusHit, type RankedChunk } from '@deepseek-ai/dsh-meteo-corpus'

function hit(key: string, score: number): RankedChunk {
  const [docId, ordinal] = key.split(':')
  const value: CorpusHit = {
    docId: brandString<CorpusDocumentId>(docId!), ordinal: Number(ordinal), headingPath: '', charStart: 0, charEnd: 1,
    text: key, docTitle: key, score,
  }
  return { ...value, key }
}

describe('semantic rank fusion', () => {
  it('combines lexical and semantic ranks once per chunk and respects the result window', () => {
    const fused = fuseRanks([hit('a:0', 100), hit('b:0', 99)], [hit('c:0', 0.9), hit('a:0', 0.1)], 2)
    expect(fused.map(value => value.text)).toEqual(['a:0', 'c:0'])
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62)
  })

  it('returns an empty list for empty inputs and handles deterministic ties', () => {
    expect(fuseRanks([], [], 5)).toEqual([])
    expect(fuseRanks([hit('z:0', 1), hit('a:0', 1)], [hit('a:0', 1), hit('z:0', 1)], 5)
      .map(value => value.text)).toEqual(['a:0', 'z:0'])
  })

  it('computes cosine similarity and handles zero or mismatched vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
    expect(() => cosineSimilarity([1], [1, 0])).toThrow('dimensions do not match')
  })
})

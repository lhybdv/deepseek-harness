/** Reciprocal-rank fusion for independent lexical and semantic candidate lists. */
import type { CorpusHit } from './types.ts'

/** Candidate hit with an index-stable key. */
export interface RankedChunk extends CorpusHit { readonly key: string }
/** Combine lexical and cosine-ranked candidates; each contribution is 1/(60+rank). @param lexical - BM25 ordered hits. @param semantic - cosine ordered hits. @param limit - result window. @returns unique hits ordered by reciprocal-rank score. */
export function fuseRanks(lexical: readonly RankedChunk[], semantic: readonly RankedChunk[], limit: number): CorpusHit[] {
  const candidates = new Map<string, { hit: RankedChunk; score: number }>()
  for (const [index, list] of [lexical, semantic].entries()) {
    list.forEach((hit, rank) => {
      const value = candidates.get(hit.key) ?? { hit, score: 0 }
      value.score += 1 / (60 + rank + 1)
      candidates.set(hit.key, value)
      if (index === 0) value.hit = hit
    })
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.hit.key.localeCompare(b.hit.key))
    .slice(0, limit).map(({ hit, score }) => ({ ...hit, score }))
}
/** Cosine similarity between equal-width vectors; zero vectors score zero. @param left - first vector. @param right - second vector. @returns similarity in [-1, 1]. */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error('Embedding dimensions do not match')
  let dot = 0, leftNorm = 0, rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!, b = right[index]!
    dot += a * b; leftNorm += a * a; rightNorm += b * b
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm)
}

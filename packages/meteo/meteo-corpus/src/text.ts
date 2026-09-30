/**
 * CJK-aware text preparation for the corpus index: chunking and tokenization.
 *
 * Both functions are pure so the indexer and the query builder can share one
 * tokenizer definition — a divergence between the two sides silently destroys
 * recall, and `sqlite.ts` therefore calls {@link indexTokens} for storage and
 * {@link bigrams} for search rather than formatting either inline.
 *
 * @module @deepseek-ai/dsh-meteo-corpus/text
 */

/** One chunk produced by {@link chunkText}, before it becomes an indexed row. */
export interface ChunkDraft {
  readonly headingPath: string
  readonly charStart: number
  readonly charEnd: number
  readonly text: string
}

/** Default maximum characters per chunk. */
export const DEFAULT_CHUNK_CHARS = 800

/**
 * Source spans that together tile the text: one sentence (its terminator
 * included) or one bare newline. Because the spans tile, a chunk built from a
 * contiguous run of them addresses the source exactly, newlines included.
 */
const SPAN = /[^。！？；.!?;\n]+[。！？；.!?;]?|\n/g

/** A markdown heading line, capturing its depth and title. */
const HEADING = /^(#{1,3})[ \t]+(.*)$/

/**
 * Split `text` into heading-scoped chunks of at most `maxChars` characters.
 *
 * Headings (`#`, `##`, `###`) open a new chunk and contribute to the chunk's
 * heading trail. Bodies are packed sentence by sentence; a single sentence
 * longer than `maxChars` is emitted whole rather than truncated, because a
 * truncated sentence is worse evidence than an oversized one. Chunk text is the
 * source range trimmed, so {@link ChunkDraft.charStart} and
 * {@link ChunkDraft.charEnd} address the original document — including the
 * newlines between lines — and a citation rendered from them matches the source.
 *
 * @param text - markdown or plain text to split.
 * @param maxChars - soft upper bound on a chunk's character count.
 * @returns the chunks in document order; a document with no content yields none.
 */
export function chunkText(text: string, maxChars: number = DEFAULT_CHUNK_CHARS): ChunkDraft[] {
  const chunks: ChunkDraft[] = []
  let headings: string[] = []
  let start = -1
  let end = -1
  let length = 0

  // `append` refuses blank spans, so a pending range always holds visible text.
  const flush = (): void => {
    if (start < 0) return
    const raw = text.slice(start, end)
    const leading = raw.length - raw.trimStart().length
    const body = raw.trim()
    chunks.push({
      headingPath: headings.join(' > '),
      charStart: start + leading,
      charEnd: start + leading + body.length,
      text: body,
    })
    start = -1
    end = -1
    length = 0
  }

  const append = (from: number, to: number): void => {
    if (text.slice(from, to).trim().length === 0) return
    if (start >= 0 && length + to - from > maxChars) flush()
    if (start < 0) start = from
    end = to
    length += to - from
  }

  for (const span of text.matchAll(SPAN)) {
    const from = span.index
    const to = from + span[0].length
    if (from === 0 || text[from - 1] === '\n') {
      const lineEnd = text.indexOf('\n', from)
      const title = HEADING.exec(text.slice(from, lineEnd < 0 ? text.length : lineEnd))
      if (title?.[1] !== undefined && title[2] !== undefined) {
        flush()
        const depth = title[1].length
        headings = [...headings.slice(0, depth - 1), title[2].trim()]
        continue
      }
    }
    append(from, to)
  }
  flush()
  return chunks
}

/**
 * Reduce `text` to the token form the index stores and queries match against.
 *
 * Returns overlapping two-character CJK bigrams: `unicode61` treats an
 * uninterrupted Han run as one token, so the raw text cannot answer a
 * two-character query such as `对流`, while its bigram form can. Latin runs are
 * lowercased and kept whole so ordinary words stay searchable.
 *
 * @param text - raw text to tokenize.
 * @returns distinct tokens in first-seen order.
 */
export function bigrams(text: string): string[] {
  const tokens: string[] = []
  const seen = new Set<string>()
  const push = (token: string): void => {
    if (token.length > 0 && !seen.has(token)) {
      seen.add(token)
      tokens.push(token)
    }
  }
  for (const run of text.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(run)) {
      if (run.length === 1) push(run)
      for (let index = 0; index < run.length - 1; index += 1) push(run.slice(index, index + 2))
    } else {
      push(run.toLowerCase())
    }
  }
  return tokens
}

/**
 * Format `text` for the FTS5 `tokens` column.
 *
 * The stored column format is a durable contract shared with the query builder:
 * both sides must reach {@link bigrams} the same way, so the space-joined form
 * is written by this one function rather than at each call site.
 *
 * @param text - raw text being indexed.
 * @returns space-joined tokens, as one discrete FTS5 column value.
 */
export function indexTokens(text: string): string {
  return bigrams(text).join(' ')
}

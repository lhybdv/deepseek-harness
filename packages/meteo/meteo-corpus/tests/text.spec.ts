/**
 * Tests for the corpus text layer: the chunker's heading scoping and
 * sentence packing, and the bigram token form that the index and the query
 * builder must agree on.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_CHUNK_CHARS, bigrams, chunkText, indexTokens } from '@deepseek-ai/dsh-meteo-corpus'

describe('chunkText', () => {
  it('returns nothing for blank text', () => {
    expect(chunkText('   \n\n  ')).toEqual([])
  })

  it('keeps an unheaded document as one chunk with an empty heading trail', () => {
    const chunks = chunkText('第一句。第二句。')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.headingPath).toBe('')
    expect(chunks[0]?.text).toBe('第一句。第二句。')
  })

  it('opens a chunk per heading and records the heading trail', () => {
    const chunks = chunkText('# 总则\n第一段。\n## 细则\n第二段。\n### 例外\n第三段。')
    expect(chunks.map(chunk => chunk.headingPath)).toEqual(['总则', '总则 > 细则', '总则 > 细则 > 例外'])
    expect(chunks.map(chunk => chunk.text)).toEqual(['第一段。', '第二段。', '第三段。'])
  })

  it('drops deeper headings when a shallower one follows', () => {
    const chunks = chunkText('# A\n## B\n### C\n正文。\n## D\n正文。')
    expect(chunks.map(chunk => chunk.headingPath)).toEqual(['A > B > C', 'A > D'])
  })

  it('splits a long body at sentence boundaries within the budget', () => {
    const sentence = '这是一句用来测试切块长度限制的话。'
    const chunks = chunkText(sentence.repeat(20), 100)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(100)
  })

  it('keeps an over-budget single sentence whole rather than truncating it', () => {
    const sentence = '无标点的超长句子'.repeat(40)
    const chunks = chunkText(sentence, 50)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe(sentence)
  })

  it('reports offsets that address the source document', () => {
    const text = '# 标题\n第一段内容。\n## 小节\n第二段内容。'
    for (const chunk of chunkText(text)) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    }
  })

  it('keeps the newlines between lines of one chunk', () => {
    const text = '第一段甲。\n第一段乙。\n第一段丙。'
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe(text)
  })

  it('addresses the source even when headings separate multi-line bodies', () => {
    const text = ['# 甲', '第一行。', '第二行。', '', '## 乙', '第三行。', '第四行。'].join('\n')
    const chunks = chunkText(text)
    expect(chunks.map(chunk => chunk.headingPath)).toEqual(['甲', '甲 > 乙'])
    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    }
    expect(chunks[0]?.text).toBe('第一行。\n第二行。')
    expect(chunks[1]?.text).toBe('第三行。\n第四行。')
  })

  it('uses the documented default budget', () => {
    expect(DEFAULT_CHUNK_CHARS).toBe(800)
  })
})

describe('bigrams', () => {
  it('emits overlapping pairs over a Han run', () => {
    expect(bigrams('强对流')).toEqual(['强对', '对流'])
  })

  it('emits a lone Han character unchanged', () => {
    expect(bigrams('风')).toEqual(['风'])
  })

  it('lowercases latin runs and keeps them whole', () => {
    expect(bigrams('Wind SPEED')).toEqual(['wind', 'speed'])
  })

  it('separates scripts and drops punctuation and whitespace', () => {
    expect(bigrams('风速 10 m/s。')).toEqual(['风速', '10', 'm', 's'])
  })

  it('returns nothing for text without letters or digits', () => {
    expect(bigrams('  ---  ')).toEqual([])
  })

  it('deduplicates while keeping first-seen order', () => {
    expect(bigrams('对流对流')).toEqual(['对流', '流对'])
  })
})

describe('indexTokens', () => {
  it('joins the token form with single spaces', () => {
    expect(indexTokens('强对流')).toBe('强对 对流')
  })
})

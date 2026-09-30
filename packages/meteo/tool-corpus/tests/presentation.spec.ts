/**
 * Unit tests for the corpus tools' model-facing renderers, canonical-value
 * projections, and the narrowing that rebuilds presentation metadata from a
 * replayed result.
 */

import { describe, expect, it } from 'vitest'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import {
  capSnippet,
  formatIngestOutput,
  formatReadOutput,
  formatSearchOutput,
  ingestMetaFromResult,
  ingestMetaFromValue,
  presentIngestCall,
  presentIngestResult,
  presentReadCall,
  presentReadResult,
  presentSearchCall,
  presentSearchResult,
  readMetaFromResult,
  readMetaFromValue,
  searchMetaFromResult,
  searchMetaFromValue,
} from '@deepseek-ai/dsh-tool-corpus'
import type {
  CorpusChunkValue, CorpusIngestOutput, CorpusIngestedDocument, CorpusReadOutput, CorpusSearchOutput,
} from '@deepseek-ai/dsh-tool-corpus'

const HIT = {
  docId: 'doc-1',
  ordinal: 0,
  docTitle: '病虫害防治气象指标',
  headingPath: '施药适宜气象条件',
  charStart: 12,
  charEnd: 240,
  text: '风速低于 3 米每秒',
}

const OTHER_HIT = {
  ...HIT,
  docId: 'doc-2',
  ordinal: 1,
  docTitle: '霜冻指标',
  headingPath: '',
  charStart: 0,
  charEnd: 40,
  text: '霜冻',
}

const ACCEPTED: CorpusIngestedDocument = {
  docId: 'doc-1', title: '病虫害防治气象指标', source: 'guide.md', bytes: 320, chunkCount: 2,
}

const ACCEPTED_WITHOUT_SOURCE: CorpusIngestedDocument = {
  docId: 'doc-2', title: '霜冻指标', source: '', bytes: 90, chunkCount: 1,
}

const INGEST_VALUE: CorpusIngestOutput = {
  documents: [ACCEPTED, ACCEPTED_WITHOUT_SOURCE],
  failures: [{ title: '空文档', code: 'CORPUS_EMPTY_DOCUMENT', message: 'document text is empty' }],
}

const SEARCH_VALUE: CorpusSearchOutput = {
  hits: [HIT, OTHER_HIT],
  matchExpression: '"打药" OR "施药"',
  empty: false,
  truncated: true,
}

const READ_CHUNK: CorpusChunkValue = {
  headingPath: '施药适宜气象条件', charStart: 240, charEnd: 480, text: '气温宜在 15 至 28 摄氏度之间。',
}

const READ_VALUE: CorpusReadOutput = { docId: 'doc-1', ordinal: 1, found: true, chunk: READ_CHUNK }

const CITATION = {
  docId: 'doc-1', ordinal: 0, docTitle: 'T', headingPath: '', charStart: 0, charEnd: 8, snippet: 'text',
}

/** A completed tool result carrying `meta`, as the registry hands it to a presenter. */
function toolResult(meta?: unknown): ToolResult {
  return { content: [], isError: false, ...(meta === undefined ? {} : { meta: meta as never }) }
}

const FAILED_RESULT: ToolResult = { content: [], isError: true }

describe('capSnippet', () => {
  it('returns text that already fits unchanged', () => {
    expect(capSnippet('施药适宜气象条件', 20)).toBe('施药适宜气象条件')
  })

  it('cuts on a code-point boundary and marks the excerpt', () => {
    expect(capSnippet('𐍀𐍀𐍀𐍀𐍀', 4)).toBe('𐍀𐍀𐍀…')
  })
})

describe('ingestMetaFromResult', () => {
  it('narrows counts and titles', () => {
    expect(ingestMetaFromResult({ indexed: 2, rejected: 1, titles: ['A', 'B'] }))
      .toEqual({ indexed: 2, rejected: 1, titles: ['A', 'B'] })
  })

  it.each([
    ['a scalar', 'indexed'],
    ['null', null],
    ['a list', []],
    ['missing counts', { indexed: 1 }],
    ['titles that is not a list', { indexed: 1, rejected: 0, titles: 'A' }],
    ['a titles list with a number', { indexed: 1, rejected: 0, titles: [1] }],
  ])('rejects %s', (_label, value) => {
    expect(ingestMetaFromResult(value)).toBeUndefined()
  })
})

describe('readMetaFromResult', () => {
  it('narrows one chunk coordinate', () => {
    const meta = { docId: 'doc-1', ordinal: 2, found: true, headingPath: 'H', chars: 228 }
    expect(readMetaFromResult(meta)).toEqual(meta)
  })

  it.each([
    ['a scalar', 'doc-1'],
    ['a partial record', { docId: 'doc-1' }],
  ])('rejects %s', (_label, value) => {
    expect(readMetaFromResult(value)).toBeUndefined()
  })
})

describe('searchMetaFromResult', () => {
  it('narrows the citation list and its window state', () => {
    expect(searchMetaFromResult({ citations: [CITATION], truncated: true }))
      .toEqual({ citations: [CITATION], truncated: true })
  })

  it.each([
    ['a scalar', 7],
    ['a list', [CITATION]],
    ['missing citations', { truncated: true }],
    ['a citation without coordinates', { truncated: true, citations: [{}] }],
  ])('rejects %s', (_label, value) => {
    expect(searchMetaFromResult(value)).toBeUndefined()
  })
})

describe('formatIngestOutput', () => {
  it('reports the batch totals, each document, and every refusal', () => {
    const text = formatIngestOutput(INGEST_VALUE)
    expect(text).toContain('Indexed 2 documents: 3 chunks, 410 bytes.')
    expect(text).toContain('- doc-1 | 病虫害防治气象指标 | chunks 2 | bytes 320 | source guide.md')
    expect(text).toContain('- doc-2 | 霜冻指标 | chunks 1 | bytes 90\nRejected documents (1):')
    expect(text).toContain('- 空文档 | CORPUS_EMPTY_DOCUMENT: document text is empty')
  })

  it('omits the provenance trail and the refusal block when there is nothing to show', () => {
    expect(formatIngestOutput({ documents: [ACCEPTED_WITHOUT_SOURCE], failures: [] }))
      .toBe('Indexed 1 documents: 1 chunks, 90 bytes.\n- doc-2 | 霜冻指标 | chunks 1 | bytes 90')
  })

  it('says so when the store refused every document', () => {
    expect(formatIngestOutput({ documents: [], failures: INGEST_VALUE.failures }))
      .toBe('Indexed 0 documents.\nRejected documents (1):\n- 空文档 | CORPUS_EMPTY_DOCUMENT: document text is empty')
  })
})

describe('ingestMetaFromValue', () => {
  it('counts the accepted and refused documents and lists the accepted titles', () => {
    expect(ingestMetaFromValue(INGEST_VALUE))
      .toEqual({ indexed: 2, rejected: 1, titles: ['病虫害防治气象指标', '霜冻指标'] })
  })
})

describe('presentIngestCall', () => {
  it('titles the card by the documents being indexed', () => {
    expect(presentIngestCall({ documents: [{ title: 'A', text: 'a' }, { title: 'B', text: 'b' }] })).toEqual({
      card: 'generic',
      title: 'Index 2 document(s): A, B',
      kind: 'edit',
      rawInput: 'A, B',
    })
  })
})

describe('presentIngestResult', () => {
  it('lists the accepted titles the index now holds', () => {
    expect(presentIngestResult(toolResult({ indexed: 2, rejected: 1, titles: ['A', 'B'] }))).toEqual({
      card: 'generic',
      title: 'Indexed 2 of 3 documents',
      content: [{ type: 'text', text: '- A\n- B' }],
    })
  })

  it('shows only the counts when the store refused everything', () => {
    expect(presentIngestResult(toolResult({ indexed: 0, rejected: 2, titles: [] })))
      .toEqual({ card: 'generic', title: 'Indexed 0 of 2 documents' })
  })

  it('falls back to the generic card when the call failed', () => {
    expect(presentIngestResult(FAILED_RESULT)).toBeUndefined()
  })

  it('falls back to the generic card when the meta is malformed', () => {
    expect(presentIngestResult(toolResult({ indexed: 1 }))).toBeUndefined()
  })
})

describe('formatSearchOutput', () => {
  it('renders each hit with its citation coordinates, a refine note, and the citation rule', () => {
    const text = formatSearchOutput(SEARCH_VALUE)
    expect(text).toContain('Matched 2 chunks (most relevant first).')
    expect(text).toContain('[1] 病虫害防治气象指标 | docId doc-1 | chunk 0 | chars 12-240 | heading 施药适宜气象条件\n风速低于 3 米每秒')
    expect(text).toContain('[2] 霜冻指标 | docId doc-2 | chunk 1 | chars 0-40\n霜冻')
    expect(text).toContain('(Showing the first 2 matches; the corpus may hold more. Narrow the question, change the terms, or raise limit.)')
    expect(text).toContain('Call corpus_read with a docId and chunk ordinal to reopen one verbatim.')
  })

  it('says the corpus did not answer and adds no refine note', () => {
    expect(formatSearchOutput({ hits: [], matchExpression: '', empty: true, truncated: false }))
      .toBe('No chunk matched. Search again with broader terms, or index the document with corpus_ingest.')
  })

  it('omits the heading trail and the refine note when neither applies', () => {
    const text = formatSearchOutput({ ...SEARCH_VALUE, hits: [OTHER_HIT], truncated: false })
    expect(text).not.toContain('heading')
    expect(text).not.toContain('Showing the first')
    expect(text).toContain('[1] 霜冻指标 | docId doc-2 | chunk 1 | chars 0-40')
  })
})

describe('searchMetaFromValue', () => {
  it('carries the citation coordinates, the capped excerpt, and the window state', () => {
    expect(searchMetaFromValue(SEARCH_VALUE, 280)).toEqual({
      citations: [
        {
          docId: 'doc-1', ordinal: 0, docTitle: '病虫害防治气象指标', headingPath: '施药适宜气象条件',
          charStart: 12, charEnd: 240, snippet: HIT.text,
        },
        {
          docId: 'doc-2', ordinal: 1, docTitle: '霜冻指标', headingPath: '', charStart: 0, charEnd: 40,
          snippet: OTHER_HIT.text,
        },
      ],
      truncated: true,
    })
  })

  it('cuts an excerpt that does not fit the configured length', () => {
    const meta = searchMetaFromValue(SEARCH_VALUE, 4) as { citations: { snippet: string }[] }
    expect(meta.citations.map(citation => citation.snippet)).toEqual(['风速低…', '霜冻'])
  })
})

describe('presentSearchCall', () => {
  it('titles the card by the question', () => {
    expect(presentSearchCall({ query: '明天能打药吗' }))
      .toEqual({ card: 'generic', title: '明天能打药吗', kind: 'search', rawInput: '明天能打药吗' })
  })
})

describe('presentSearchResult', () => {
  it('lists the citations without repeating the chunk texts', () => {
    expect(presentSearchResult({ query: 'q' }, toolResult({ citations: [CITATION], truncated: false }))).toEqual({
      card: 'generic',
      title: 'q',
      content: [{ type: 'text', text: '- T | chunk 0 | chars 0-8' }],
    })
  })

  it('shows the question alone when nothing matched', () => {
    expect(presentSearchResult({ query: 'q' }, toolResult({ citations: [], truncated: false })))
      .toEqual({ card: 'generic', title: 'q' })
  })

  it('falls back to the generic card when the call failed', () => {
    expect(presentSearchResult({ query: 'q' }, FAILED_RESULT)).toBeUndefined()
  })

  it('falls back to the generic card when the meta is malformed', () => {
    expect(presentSearchResult({ query: 'q' }, toolResult({ truncated: true }))).toBeUndefined()
  })
})

describe('formatReadOutput', () => {
  it('renders the chunk verbatim under its coordinates', () => {
    expect(formatReadOutput(READ_VALUE))
      .toBe('Chunk 1 of document doc-1 | chars 240-480 | heading 施药适宜气象条件\n\n气温宜在 15 至 28 摄氏度之间。')
  })

  it('omits the heading trail when the document has no headings', () => {
    expect(formatReadOutput({ ...READ_VALUE, chunk: { ...READ_CHUNK, headingPath: '' } }))
      .toBe('Chunk 1 of document doc-1 | chars 240-480\n\n气温宜在 15 至 28 摄氏度之间。')
  })

  it('names the chunk it could not find', () => {
    expect(formatReadOutput({ docId: 'doc-9', ordinal: 7, found: false }))
      .toBe('Document doc-9 has no chunk 7. Run corpus_search again for a docId and chunk ordinal the index holds now.')
  })
})

describe('readMetaFromValue', () => {
  it('reports the chunk size as its character span', () => {
    expect(readMetaFromValue(READ_VALUE))
      .toEqual({ docId: 'doc-1', ordinal: 1, found: true, headingPath: '施药适宜气象条件', chars: 240 })
  })

  it('reports a miss as an empty trail and zero size', () => {
    expect(readMetaFromValue({ docId: 'doc-9', ordinal: 7, found: false }))
      .toEqual({ docId: 'doc-9', ordinal: 7, found: false, headingPath: '', chars: 0 })
  })
})

describe('presentReadCall', () => {
  it('names the chunk being reopened', () => {
    expect(presentReadCall({ docId: 'doc-1', ordinal: 1 })).toEqual({
      card: 'generic',
      title: 'Read chunk 1 of doc-1',
      kind: 'read',
      rawInput: { docId: 'doc-1', ordinal: 1 },
    })
  })
})

describe('presentReadResult', () => {
  it('shows the heading trail the chunk sits under', () => {
    expect(presentReadResult(toolResult({
      docId: 'doc-1', ordinal: 1, found: true, headingPath: '施药适宜气象条件', chars: 240,
    }))).toEqual({
      card: 'generic',
      title: 'Read 240 characters (chunk 1)',
      content: [{ type: 'text', text: '施药适宜气象条件' }],
    })
  })

  it('shows only the size when the chunk has no heading trail', () => {
    expect(presentReadResult(toolResult({ docId: 'doc-1', ordinal: 1, found: true, headingPath: '', chars: 240 })))
      .toEqual({ card: 'generic', title: 'Read 240 characters (chunk 1)' })
  })

  it('says the chunk is gone', () => {
    expect(presentReadResult(toolResult({ docId: 'doc-9', ordinal: 7, found: false, headingPath: '', chars: 0 })))
      .toEqual({ card: 'generic', title: 'No chunk 7 in doc-9' })
  })

  it('falls back to the generic card when the call failed', () => {
    expect(presentReadResult(FAILED_RESULT)).toBeUndefined()
  })

  it('falls back to the generic card when the meta is malformed', () => {
    expect(presentReadResult(toolResult({ docId: 'doc-1' }))).toBeUndefined()
  })
})

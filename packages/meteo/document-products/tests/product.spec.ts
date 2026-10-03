/** Behavior tests for numeric grounding, polish contracts, and publication state. */
import { describe, expect, it } from 'vitest'
import { legalProductActions, transitionProduct, verifyPolish, verifyProduct } from '../src/product.ts'
import type { DocumentProduct, ProductDataValue } from '../src/product.ts'
import { assertConfig } from '../src/config.ts'
const id = 'product-1' as DocumentProduct['id']
const values: ProductDataValue[] = [{ value: 12.5, source: 'observation:rain', stationId: 'st-1', period: '2026-10-02' }]
const draft: DocumentProduct = { id, kind: '灾害预警产品', title: '预警', sections: [{ heading: '监测', body: '降水12.5毫米' }], body: '降水12.5毫米', citations: [{ claim: '降水建议', documentId: 'doc-a', ordinal: 1, charStart: 4, charEnd: 12, text: '降水注意' }], provenance: values, state: 'draft', history: [], version: 0 }
describe('deployment configuration', () => {
  it('accepts positive integer limits and rejects invalid values', () => {
    expect(() => assertConfig({ forecastHours: 72, citationLimit: 5 })).not.toThrow()
    expect(() => assertConfig({ forecastHours: 0, citationLimit: 5 })).toThrow(/forecastHours/)
    expect(() => assertConfig({ forecastHours: 72, citationLimit: 1.5 })).toThrow(/citationLimit/)
  })
})
describe('data verification', () => {
  it('accepts filled data and rejects a fabricated number', () => {
    expect(() => verifyProduct('降水12.5毫米', values, draft.citations)).not.toThrow()
    expect(() => verifyProduct('降水12.5毫米，风速99米每秒', values, draft.citations)).toThrow(/Unverified number/)
  })
  it('keeps all citations and section headings during polishing', () => {
    expect(() => verifyPolish(draft, { ...draft, body: '实测降水12.5毫米，请关注。' })).not.toThrow()
    expect(() => verifyPolish(draft, { ...draft, body: '降水13毫米' })).toThrow(/numbers/)
    expect(() => verifyPolish(draft, { ...draft, citations: [] })).toThrow(/citations/)
    const noNumbers = { ...draft, body: '气象情况稳定', sections: [{ heading: '监测', body: '请继续关注' }] }
    expect(() => verifyPolish(noNumbers, noNumbers)).not.toThrow()
    expect(() => verifyProduct('无数值正文', [], [])).not.toThrow()
    const validCitation = { claim: 'x', documentId: 'doc', ordinal: 0, charStart: 0, charEnd: 1, text: 'x' }
    expect(() => verifyProduct('正文', [], [{ ...validCitation, documentId: '' }])).toThrow(/coordinates/)
    expect(() => verifyProduct('正文', [], [{ ...validCitation, ordinal: -1 }])).toThrow(/coordinates/)
    expect(() => verifyProduct('正文', [], [{ ...validCitation, charStart: -1 }])).toThrow(/coordinates/)
    expect(() => verifyProduct('正文', [], [{ ...validCitation, charEnd: -1 }])).toThrow(/coordinates/)
    expect(() => verifyPolish(draft, { ...draft, sections: [{ heading: '其他', body: '降水12.5毫米' }] })).toThrow(/section contract/)
  })
})
describe('lifecycle', () => {
  it('enforces all legal state edges, actor attribution and versioned immutable releases', () => {
    expect(() => verifyPolish(draft, { ...draft, provenance: [] })).toThrow(/provenance/)
    expect(legalProductActions('in_review')).toEqual(['approve', 'reject'])
    expect(legalProductActions('approved')).toEqual(['publish'])
    expect(legalProductActions('rejected')).toEqual(['revise'])
    expect(legalProductActions('published')).toEqual(['publish', 'archive'])
    expect(legalProductActions('archived')).toEqual([])
    expect(() => transitionProduct(draft, 'approve', 'reviewer', '2026-10-02T00:00:00Z')).toThrow(/Illegal/)
    expect(() => transitionProduct(draft, 'submit', '', '2026-10-02T00:00:00Z')).toThrow(/actor/)
    const review = transitionProduct(draft, 'submit', 'author', '2026-10-02T00:00:00Z').product
    const approved = transitionProduct(review, 'approve', 'reviewer', '2026-10-02T00:01:00Z').product
    const first = transitionProduct(approved, 'publish', 'publisher', '2026-10-02T00:02:00Z')
    expect(first.product.version).toBe(1)
    expect(first.release?.version).toBe(1)
    expect(Object.isFrozen(first.release)).toBe(true)
    const second = transitionProduct(first.product, 'publish', 'publisher', '2026-10-02T00:03:00Z')
    expect(second.product.version).toBe(2)
    const archived = transitionProduct(second.product, 'archive', 'archivist', '2026-10-02T00:04:00Z').product
    expect(archived.state).toBe('archived')
    expect(legalProductActions(archived.state)).toEqual([])
    const rejected = transitionProduct(review, 'reject', 'reviewer', '2026-10-02T00:06:00Z').product
    const revised = transitionProduct(rejected, 'revise', 'author', '2026-10-02T00:07:00Z').product
    expect(revised.state).toBe('draft')
    const states = [draft, review, approved, first.product, archived, rejected]
    const actions = ['submit', 'approve', 'reject', 'revise', 'publish', 'archive'] as const
    for (const product of states) for (const action of actions) {
      const run = () => transitionProduct(product, action, 'actor', '2026-10-02T00:08:00Z')
      if (legalProductActions(product.state).includes(action)) expect(run).not.toThrow()
      else expect(run).toThrow(/Illegal/)
    }
  })
})

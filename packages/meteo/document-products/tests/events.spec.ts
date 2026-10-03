/** Session event behavior for generated products and actor-attributed lifecycle replay. */
import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { DocumentProduct } from '../src/product.ts'
import { appendProductCreated, transitionInSession } from '../src/events.ts'
const product: DocumentProduct = { id: 'event-product' as DocumentProduct['id'], kind: '灾害预警产品', title: '预警', sections: [], body: '正文', citations: [], provenance: [], state: 'draft', history: [], version: 0 }
describe('document product session events', () => {
  it('replays the complete product, attributed transitions, release, and archive', () => {
    const session = Session.create(SessionId('meteo-products'))
    appendProductCreated(session, product)
    let current = transitionInSession(session, product, 'submit', 'author', '2026-10-02T00:00:00Z').product
    current = transitionInSession(session, current, 'approve', 'reviewer', '2026-10-02T00:01:00Z').product
    const published = transitionInSession(session, current, 'publish', 'publisher', '2026-10-02T00:02:00Z')
    const archived = transitionInSession(session, published.product, 'archive', 'archivist', '2026-10-02T00:03:00Z')
    const events = session.snapshotEvents()
    expect(events.map(event => event.type)).toEqual(['meteo/product-created', 'meteo/product-transition', 'meteo/product-transition', 'meteo/product-transition', 'meteo/product-transition'])
    expect(events[0]?.type === 'meteo/product-created' ? events[0].data.product : undefined).toEqual(product)
    expect(events[2]?.type === 'meteo/product-transition' ? events[2].data.actor : undefined).toBe('reviewer')
    expect(events[3]?.type === 'meteo/product-transition' ? events[3].data.release?.version : undefined).toBe(1)
    expect(archived.product.state).toBe('archived')
  })
})

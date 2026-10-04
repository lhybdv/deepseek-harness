/** Session-scoped Remote controller lifecycle behavior. */
import DocumentProductsController from '../src/index.ts'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentProductService } from '@deepseek-ai/dsh-document-products'
import type { Session } from '@deepseek-ai/dsh-session'

describe('document product Remote controller', () => {
  it('routes generation and lifecycle calls through the addressed session', async () => {
    const session = {} as Session
    const product = { id: 'p' }
    const service = {
      generate: vi.fn(async () => product), list: vi.fn(() => [product]),
      act: vi.fn(() => ({ product, release: { version: 1 } })), releases: vi.fn(() => [{ version: 1 }]),
    } as unknown as DocumentProductService
    const ctx = { sessions: { get: (id: string) => id === 's' ? session : undefined }, documentProducts: service }
    const controller = Object.create(DocumentProductsController.prototype) as DocumentProductsController
    Object.defineProperty(controller, 'ctx', { value: ctx })
    const request = { sessionId: 's', input: {} } as never
    await expect(controller.generate(request)).resolves.toBe(product)
    expect(controller.list('s' as never)).toEqual([product])
    expect(controller.act({ sessionId: 's' as never, id: 'p' as never, action: 'submit', actor: 'reviewer', at: 'now' })).toEqual({ product, release: { version: 1 } })
    expect(controller.releases('s' as never)).toEqual([{ version: 1 }])
    expect(service.generate).toHaveBeenCalledWith(session, {})
    expect(service.act).toHaveBeenCalledWith(session, 'p', 'submit', 'reviewer', 'now')
  })
  it('rejects unknown sessions instead of creating orphan records', () => {
    const controller = Object.create(DocumentProductsController.prototype) as DocumentProductsController
    Object.defineProperty(controller, 'ctx', { value: { sessions: { get: () => undefined } } })
    expect(() => controller.list('missing' as never)).toThrow('Unknown session')
  })
})

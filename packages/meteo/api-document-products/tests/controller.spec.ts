/** Session-scoped Remote controller lifecycle behavior. */
import DocumentProductsController from '../src/index.ts'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActRequest, ProductId, GenerateRequest } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * A controller whose Remote registration is real while the addressed seams stay settable:
 * only the controller's own construction runs against `ctx`, and every method call reads
 * the stub context installed afterwards.
 * @param session - session the stub store resolves for id `s`.
 * @param service - document product seam the controller forwards to.
 * @returns controller bound to the stub context.
 */
function harness(session: Session | undefined, service: Record<string, unknown> = {}): DocumentProductsController {
  const ctx = new Context()
  contexts.push(ctx)
  const controller = new DocumentProductsController(ctx)
  Object.defineProperty(controller, 'ctx', { value: { sessions: { get: (id: SessionId) => id === 's' ? session : undefined }, documentProducts: service } })
  return controller
}

const id = brandString<ProductId>('p')
const generate: GenerateRequest = { sessionId: SessionId('s'), input: { kind: '灾害预警产品', stationId: 'hl-wc-01', from: '2026-09-23', to: '2026-09-23' } }
const act: ActRequest = { sessionId: SessionId('s'), id, action: 'submit', actor: 'reviewer', at: 'now' }

describe('document product Remote controller', () => {
  it('routes generation and lifecycle calls through the addressed session', async () => {
    const session = {} as Session
    const stored = { id, state: 'draft' }
    const service = {
      generate: vi.fn(async () => stored), list: vi.fn(() => [stored]),
      act: vi.fn(() => ({ product: stored, release: { version: 1 } })), releases: vi.fn(() => [{ version: 1 }]),
    }
    const controller = harness(session, service)
    await expect(controller.generate(generate)).resolves.toEqual({ ...stored, legalActions: ['edit', 'submit'] })
    expect(controller.list(SessionId('s'))).toEqual([{ ...stored, legalActions: ['edit', 'submit'] }])
    expect(controller.act(act)).toEqual({ product: { ...stored, legalActions: ['edit', 'submit'] }, release: { version: 1 } })
    expect(controller.releases(SessionId('s'))).toEqual([{ version: 1 }])
    expect(service.generate).toHaveBeenCalledWith(session, generate.input)
    expect(service.act).toHaveBeenCalledWith(session, id, 'submit', 'reviewer', 'now')
  })
  it('answers a transition that publishes nothing without a release', () => {
    const stored = { id, state: 'approved' }
    const controller = harness({} as Session, { act: vi.fn(() => ({ product: stored })) })
    expect(controller.act({ ...act, action: 'approve' })).toEqual({ product: { ...stored, legalActions: ['publish'] } })
  })
  it('rejects unknown sessions instead of creating orphan records', () => {
    const controller = harness(undefined)
    expect(() => controller.generate(generate)).toThrow('Unknown session')
    expect(() => controller.list(SessionId('missing'))).toThrow('Unknown session')
    expect(() => controller.act(act)).toThrow('Unknown session')
    expect(() => controller.releases(SessionId('missing'))).toThrow('Unknown session')
  })
  it('routes body edits to the verified document service and returns the new legal actions', () => {
    const stored = { id, state: 'draft' }
    const service = { edit: vi.fn(() => stored) }
    const controller = harness({} as Session, service)
    expect(controller.act({ ...act, action: 'edit', body: 'Updated body' })).toEqual({ product: { ...stored, legalActions: ['edit', 'submit'] } })
    expect(service.edit).toHaveBeenCalledWith(expect.anything(), id, 'Updated body', 'reviewer', 'now')
    expect(() => controller.act({ ...act, action: 'edit' })).toThrow('edit needs body')
  })
})

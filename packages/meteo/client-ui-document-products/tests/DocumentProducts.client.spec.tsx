// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-api-document-products/remote', () => ({ default: {} }))
import type { Context } from '@deepseek-ai/cordis'
import type { DocumentProduct, ProductAction, ProductId } from '@deepseek-ai/dsh-document-products'
import { brandString } from '@deepseek-ai/dsh-brand'
import { transitionProduct } from '@deepseek-ai/dsh-document-products'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import { DocumentProductsIcon, DocumentProductsPanel } from '../src/client/DocumentProducts.tsx'
import { en } from '../src/client/locales.ts'
import { apply } from '../src/client/mount.ts'

const sessionId = SessionId('document-products-session')
const secondSessionId = SessionId('document-products-session-2')
const labels = en
const t = (key: keyof typeof en): string => labels[key]
const initialProduct: DocumentProduct = {
  id: brandString<ProductId>('product-1'),
  kind: '灾害预警产品',
  title: '暴雨预警产品',
  sections: [{ heading: '监测与预报', body: '雨量持续增加' }],
  body: '请关注降雨变化。',
  citations: [{ claim: '降雨风险', documentId: 'guide', ordinal: 2, charStart: 0, charEnd: 8, text: '风险提示' }],
  provenance: [],
  state: 'draft',
  history: [],
  version: 0,
}

type Success<T> = { readonly ok: true; readonly value: T }
const success = <T,>(value: T): Success<T> => ({ ok: true, value })

type Outcome<T> = Success<T> | { readonly ok: false; readonly error: Error }
interface ProductRemoteStub {
  readonly list: (requestedSession: typeof sessionId) => Promise<Outcome<readonly DocumentProduct[]>>
  readonly generate: (request: { readonly sessionId: typeof sessionId }) => Promise<Outcome<DocumentProduct>>
  readonly act: (request: { readonly sessionId: typeof sessionId; readonly id: ProductId; readonly action: ProductAction; readonly actor: string; readonly at: string }) => Promise<Outcome<{ readonly product: DocumentProduct }>>
}

afterEach(() => vi.restoreAllMocks())

function lifecycleRemote() {
  const products: DocumentProduct[] = []
  let nextId = 1
  const remote = {
    list: vi.fn(async (_requestedSession: typeof sessionId) => success([...products])),
    generate: vi.fn(async ({ sessionId: _requestedSession }: { readonly sessionId: typeof sessionId }) => {
      const product = { ...initialProduct, id: brandString<ProductId>(`product-${nextId++}`) }
      products.push(product)
      return success(product)
    }),
    act: vi.fn(async ({ sessionId: _requestedSession, id, action, actor, at }: { readonly sessionId: typeof sessionId; readonly id: ProductId; readonly action: ProductAction; readonly actor: string; readonly at: string }) => {
      const index = products.findIndex(product => product.id === id)
      const updated = transitionProduct(products[index]!, action, actor, at).product
      products[index] = updated
      return success({ product: updated })
    }),
  }
  return { remote, products }
}

function sessionSelector(ids: readonly typeof sessionId[]): UseSessions {
  return ((selector: (state: { ids: readonly typeof sessionId[] }) => unknown) => selector({ ids })) as UseSessions
}

function ProductPanel({ remote, sessions = [sessionId] }: {
  readonly remote: ProductRemoteStub
  readonly sessions?: readonly typeof sessionId[]
}) {
  return <DocumentProductsPanel remote={remote as never} useSessions={sessionSelector(sessions)} t={t} />
}

describe('document products client', () => {
  it('registers the panel in sidebar.panellist and its keyed main body', async () => {
    const entries: Array<{ options: { name: string; id?: string; key?: string; label?: () => string; inject?: () => unknown }; component: unknown }> = []
    const injected: string[] = []
    const productRemote = lifecycleRemote().remote
    const ctx = {
      remote: { $mount: vi.fn(async () => vi.fn(async () => {})), documentProducts: productRemote },
      locale: {
        bind: () => t,
        register: vi.fn(() => vi.fn()),
      },
      slots: {
        inject: (name: string, register: () => unknown) => { injected.push(name); return register() },
        register: (options: { name: string; id?: string; key?: string; label?: () => string; inject?: () => unknown }, component: unknown) => {
          entries.push({ options, component })
          return vi.fn()
        },
      },
      effect: (effect: () => unknown) => effect(),
    }
    await apply(ctx as Context)
    expect(ctx.remote.$mount).toHaveBeenCalledOnce()
    expect(ctx.locale.register).toHaveBeenCalledOnce()
    expect(entries.map(entry => entry.options.name)).toEqual(['sidebar.panellist', 'main'])
    expect(injected).toEqual(['sidebar.panellist', 'main'])
    expect(entries[0]?.options).toMatchObject({ id: 'meteo-document-products' })
    expect(entries[1]?.options).toMatchObject({ key: 'meteo-document-products' })
    expect(entries[0]?.options.label?.()).toBe(labels.title)
    expect(entries[1]?.options.inject?.()).toEqual({ remote: productRemote })
    expect(render(<DocumentProductsIcon />).container.textContent).toBe('文')
  })

  it('drives generation, review, publication, archive, and rejection back to draft through the Remote face', async () => {
    const { remote } = lifecycleRemote()
    render(<ProductPanel remote={remote} />)
    await screen.findByText(labels.empty)
    fireEvent.click(await screen.findByRole('button', { name: labels.generate }))
    let product = await screen.findByRole('article')
    expect(within(product).getByText(labels.draft)).toBeTruthy()
    expect(within(product).getByText('监测与预报')).toBeTruthy()
    expect(within(product).getByText(/风险提示/)).toBeTruthy()

    fireEvent.click(within(product).getByRole('button', { name: labels.submit }))
    await waitFor(() => expect(within(screen.getByRole('article')).getByText(labels.in_review)).toBeTruthy())
    product = screen.getByRole('article')
    fireEvent.click(within(product).getByRole('button', { name: labels.approve }))
    await waitFor(() => expect(within(screen.getByRole('article')).getByText(labels.approved)).toBeTruthy())
    product = screen.getByRole('article')
    fireEvent.click(within(product).getByRole('button', { name: labels.publish }))
    await waitFor(() => expect(within(screen.getByRole('article')).getByText(labels.published)).toBeTruthy())
    product = screen.getByRole('article')
    expect(within(product).getByText(`${labels.version}: 1`)).toBeTruthy()
    fireEvent.click(within(product).getByRole('button', { name: labels.archive }))
    await waitFor(() => expect(within(screen.getByRole('article')).getByText(labels.archived)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: labels.generate }))
    const second = await screen.findAllByRole('article')
    fireEvent.click(within(second[1]!).getByRole('button', { name: labels.submit }))
    await waitFor(() => expect(within(screen.getAllByRole('article')[1]!).getByText(labels.in_review)).toBeTruthy())
    fireEvent.click(within(screen.getAllByRole('article')[1]!).getByRole('button', { name: labels.reject }))
    await waitFor(() => expect(within(screen.getAllByRole('article')[1]!).getByText(labels.rejected)).toBeTruthy())
    fireEvent.click(within(screen.getAllByRole('article')[1]!).getByRole('button', { name: labels.revise }))
    await waitFor(() => expect(within(screen.getAllByRole('article')[1]!).getByText(labels.draft)).toBeTruthy())
    expect(remote.generate).toHaveBeenCalledTimes(2)
    expect(remote.generate.mock.calls.map(([request]) => request.sessionId)).toEqual([sessionId, sessionId])
    expect(remote.act.mock.calls.map(([request]) => [request.sessionId, request.action])).toEqual([
      [sessionId, 'submit'], [sessionId, 'approve'], [sessionId, 'publish'], [sessionId, 'archive'],
      [sessionId, 'submit'], [sessionId, 'reject'], [sessionId, 'revise'],
    ])
    expect(remote.list.mock.calls.every(([requestedSession]) => requestedSession === sessionId)).toBe(true)

  })
  it('shows pending and failed list states to the user', async () => {
    let settle!: (value: { readonly ok: false; readonly error: Error }) => void
    const remote = {
      list: vi.fn(() => new Promise<{ readonly ok: false; readonly error: Error }>(resolve => { settle = resolve })),
      generate: vi.fn(async () => success(initialProduct)),
      act: vi.fn(async () => success({ product: initialProduct })),
    }
    render(<ProductPanel remote={remote} />)
    expect(screen.getByRole('status').textContent).toBe(labels.pending)
    settle({ ok: false, error: new Error('list unavailable') })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('list unavailable'))
  })

  it('shows failed generation and transition requests', async () => {
    const generation = lifecycleRemote().remote
    generation.generate.mockRejectedValueOnce(new Error('generation unavailable'))
    const generated = render(<ProductPanel remote={generation} />)
    await screen.findByText(labels.empty)
    fireEvent.click(screen.getByRole('button', { name: labels.generate }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('generation unavailable'))
    generated.unmount()

    const transition = lifecycleRemote().remote
    render(<ProductPanel remote={transition} />)
    fireEvent.click(await screen.findByRole('button', { name: labels.generate }))
    const product = await screen.findByRole('article')
    transition.act.mockRejectedValueOnce(new Error('transition unavailable'))
    fireEvent.click(within(product).getByRole('button', { name: labels.submit }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('transition unavailable'))
  })
  it('disables generation when there is no session to address', () => {
    const { remote } = lifecycleRemote()
    render(<ProductPanel remote={remote} sessions={[]} />)
    expect(screen.getByRole('button', { name: labels.generate }).hasAttribute('disabled')).toBe(true)
    expect(remote.list).not.toHaveBeenCalled()
  })
  it('loads the newly selected session instead of retaining stale session products', async () => {
    const { remote } = lifecycleRemote()
    const sessions = [sessionId, secondSessionId]
    const view = render(<ProductPanel remote={remote} sessions={sessions} />)
    await waitFor(() => expect(remote.list).toHaveBeenCalledWith(sessionId))
    view.rerender(<ProductPanel remote={remote} sessions={[secondSessionId]} />)
    await waitFor(() => expect(remote.list).toHaveBeenCalledWith(secondSessionId))
  })



})

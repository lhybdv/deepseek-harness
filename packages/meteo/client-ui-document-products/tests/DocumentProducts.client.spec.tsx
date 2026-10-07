// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-api-document-products/remote', () => ({ default: {} }))
import type { DocumentProduct, ProductAction, ProductId } from '@deepseek-ai/dsh-document-products'
import { brandString } from '@deepseek-ai/dsh-brand'
import { legalProductActions, transitionProduct } from '@deepseek-ai/dsh-document-products'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import { DocumentProducts, DocumentProductsIcon, DocumentProductsPanel } from '../src/client/DocumentProducts.tsx'
import { en } from '../src/client/locales.ts'
import { apply } from '../src/client/index.ts'

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
type ActionableProduct = DocumentProduct & { readonly legalActions: readonly ProductAction[] }
const withActions = (product: DocumentProduct): ActionableProduct => ({ ...product, legalActions: legalProductActions(product.state) })

type Success<T> = { readonly ok: true; readonly value: T }
const success = <T,>(value: T): Success<T> => ({ ok: true, value })

type Outcome<T> = Success<T> | { readonly ok: false; readonly error: Error }
interface ProductRemoteStub {
  readonly list: (requestedSession: typeof sessionId) => Promise<Outcome<readonly ActionableProduct[]>>
  readonly generate: (request: { readonly sessionId: typeof sessionId }) => Promise<Outcome<ActionableProduct>>
  readonly act: (request: {
    readonly sessionId: typeof sessionId
    readonly id: ProductId
    readonly action: ProductAction
    readonly actor: string
    readonly at: string
    readonly body?: string
  }) => Promise<Outcome<{ readonly product: ActionableProduct }>>
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function lifecycleRemote() {
  const products: DocumentProduct[] = []
  let nextId = 1
  const remote = {
    list: vi.fn(async (_requestedSession: typeof sessionId) => success(products.map(withActions))),
    generate: vi.fn(async ({ sessionId: _requestedSession }: { readonly sessionId: typeof sessionId }) => {
      const product = { ...initialProduct, id: brandString<ProductId>(`product-${nextId++}`) }
      products.push(product)
      return success(withActions(product))
    }),
    act: vi.fn(async ({
      sessionId: _requestedSession,
      id,
      action,
      actor,
      at,
      body,
    }: {
      readonly sessionId: typeof sessionId
      readonly id: ProductId
      readonly action: ProductAction
      readonly actor: string
      readonly at: string
      readonly body?: string
    }) => {
      const index = products.findIndex(product => product.id === id)
      const transitioned = transitionProduct(products[index]!, action, actor, at).product
      const updated = action === 'edit' ? { ...transitioned, body: body ?? '' } : transitioned
      products[index] = updated
      return success({ product: withActions(updated) })
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
    const entries: Array<{
      options: { name: string; id?: string; key?: string; label?: () => string; inject?: () => unknown }
      component: unknown
    }> = []
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
        register: (
          options: { name: string; id?: string; key?: string; label?: () => string; inject?: () => unknown },
          component: unknown,
        ) => {
          entries.push({ options, component })
          return vi.fn()
        },
      },
      effect: (effect: () => unknown) => effect(),
    }
    await Reflect.apply(apply, undefined, [ctx])
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

    fireEvent.click(within(product).getByRole('button', { name: labels.edit }))
    const editor = within(product).getByRole('textbox', { name: labels.editBody })
    fireEvent.change(editor, { target: { value: '修改后的预警正文' } })
    fireEvent.click(within(product).getByRole('button', { name: labels.save }))
    await waitFor(() => expect(within(screen.getByRole('article')).getByText('修改后的预警正文')).toBeTruthy())
    expect(remote.act.mock.calls[0]?.[0]).toMatchObject({ action: 'edit', body: '修改后的预警正文' })
    await waitFor(() => expect(within(screen.getByRole('article')).getByRole('button', { name: labels.submit })).toHaveProperty('disabled', false))
    product = screen.getByRole('article')
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
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2))
    const second = screen.getAllByRole('article')
    fireEvent.click(within(second[1]!).getByRole('button', { name: labels.submit }))
    await waitFor(() => expect(within(screen.getAllByRole('article')[1]!).getByText(labels.in_review)).toBeTruthy())
    fireEvent.click(within(screen.getAllByRole('article')[1]!).getByRole('button', { name: labels.reject }))
    await waitFor(() => expect(within(screen.getAllByRole('article')[1]!).getByText(labels.rejected)).toBeTruthy())
    fireEvent.click(within(screen.getAllByRole('article')[1]!).getByRole('button', { name: labels.revise }))
    await waitFor(() => expect(within(screen.getAllByRole('article')[1]!).getByText(labels.draft)).toBeTruthy())
    expect(remote.generate).toHaveBeenCalledTimes(2)
    expect(remote.generate.mock.calls.map(([request]) => request.sessionId)).toEqual([sessionId, sessionId])
    expect(remote.act.mock.calls.map(([request]) => [request.sessionId, request.action])).toEqual([
      [sessionId, 'edit'], [sessionId, 'submit'], [sessionId, 'approve'], [sessionId, 'publish'], [sessionId, 'archive'],
      [sessionId, 'submit'], [sessionId, 'reject'], [sessionId, 'revise'],
    ])
    expect(remote.list.mock.calls.every(([requestedSession]) => requestedSession === sessionId)).toBe(true)

  })
  it('renders products without controls when no action callbacks are supplied', () => {
    render(<DocumentProducts products={[withActions(initialProduct)]} pending={false} error="" t={t} />)
    expect(screen.getByText(labels.draft)).toBeTruthy()
    expect(screen.queryByRole('button', { name: labels.generate })).toBeNull()
    expect(screen.queryByRole('button', { name: labels.submit })).toBeNull()
  })
  it('shows pending and failed list states to the user', async () => {
    let settle!: (value: { readonly ok: false; readonly error: Error }) => void
    const remote = {
      list: vi.fn(() => new Promise<{ readonly ok: false; readonly error: Error }>((resolve) => { settle = resolve })),
      generate: vi.fn(async () => success(withActions(initialProduct))),
      act: vi.fn(async () => success({ product: withActions(initialProduct) })),
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
  it('shows failures returned by generation, refresh, and action calls', async () => {
    const { remote } = lifecycleRemote()
    remote.generate.mockResolvedValueOnce({ ok: false, error: new Error('generation refused') } as never)
    remote.list.mockResolvedValueOnce(success([]))
    remote.list.mockResolvedValueOnce({ ok: false, error: new Error('refresh unavailable') } as never)
    render(<ProductPanel remote={remote} />)
    await screen.findByText(labels.empty)
    fireEvent.click(screen.getByRole('button', { name: labels.generate }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('generation refused'))

    fireEvent.click(screen.getByRole('button', { name: labels.generate }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('refresh unavailable'))
    fireEvent.click(screen.getByRole('button', { name: labels.generate }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2))
    const product = screen.getAllByRole('article')[0]!
    remote.act.mockResolvedValueOnce({ ok: false, error: new Error('action refused') } as never)
    fireEvent.click(within(product).getByRole('button', { name: labels.submit }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('action refused'))
  })
  it('ignores a session load that finishes after unmount', async () => {
    let settle!: (value: Outcome<readonly ActionableProduct[]>) => void
    const remote = {
      list: vi.fn(() => new Promise<Outcome<readonly ActionableProduct[]>>((resolve) => { settle = resolve })),
      generate: vi.fn(async () => success(withActions(initialProduct))),
      act: vi.fn(async () => success({ product: withActions(initialProduct) })),
    }
    const view = render(<ProductPanel remote={remote} />)
    view.unmount()
    await act(async () => { settle(success([])) })
    expect(remote.list).toHaveBeenCalledWith(sessionId)
    let fail!: (reason: Error) => void
    const rejectingRemote = {
      list: vi.fn(() => new Promise<Outcome<readonly ActionableProduct[]>>((_, reject) => { fail = reject })),
      generate: vi.fn(async () => success(withActions(initialProduct))),
      act: vi.fn(async () => success({ product: withActions(initialProduct) })),
    }
    const rejectingView = render(<ProductPanel remote={rejectingRemote} />)
    rejectingView.unmount()
    await act(async () => { fail(new Error('late rejection')) })
  })

  it('shows a rejected initial session-list request', async () => {
    const { remote } = lifecycleRemote()
    remote.list.mockRejectedValueOnce(new Error('list transport failed'))
    render(<ProductPanel remote={remote} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('list transport failed'))
  })
  it('shows the no-session state without issuing remote actions', () => {
    const { remote } = lifecycleRemote()
    render(<ProductPanel remote={remote} sessions={[]} />)
    expect(screen.getByText(labels.noSession)).toBeTruthy()
    expect(screen.queryByRole('button', { name: labels.generate })).toBeNull()
    expect(remote.list).not.toHaveBeenCalled()
  })
  it('loads the newly selected session instead of retaining stale session products', async () => {
    const { remote } = lifecycleRemote()
    const sessions = [sessionId, secondSessionId]
    const view = render(<ProductPanel remote={remote} sessions={sessions} />)
    await waitFor(() => expect(remote.list).toHaveBeenCalledWith(sessionId))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: secondSessionId } })
    await waitFor(() => expect(remote.list).toHaveBeenCalledWith(secondSessionId))
    view.rerender(<ProductPanel remote={remote} sessions={[sessionId]} />)
    await waitFor(() => expect(remote.list.mock.calls.at(-1)?.[0]).toBe(sessionId))
  })



})

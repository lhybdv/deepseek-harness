/** Session document list, generation, and review controls. */
import { useCallback, useEffect, useState } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import { legalProductActions, type DocumentProduct, type ProductAction } from '@deepseek-ai/dsh-document-products'
import type { ProductPanelKey } from './locales.ts'
import { NS } from './locales.ts'

/** Compact glyph shown beside the document products panel name. @returns panel glyph. */
export function DocumentProductsIcon() {
  return <span aria-hidden="true">文</span>
}

/** Product records, legal actions, progress, errors, and localized panel controls. */
export interface DocumentProductsProps {
  /** Current session's product records. */
  readonly products: readonly DocumentProduct[]
  /** Legal transitions for one product state. */
  readonly legalActions: (state: DocumentProduct['state']) => readonly ProductAction[]
  /** Apply an action to a product. */
  readonly onAction: (productId: DocumentProduct['id'], action: ProductAction) => void
  /** Generate a draft in the selected session. */
  readonly onGenerate: () => void
  /** Whether a session is available for remote operations. */
  readonly available: boolean
  /** Whether a remote operation is in progress. */
  readonly pending: boolean
  /** Latest visible operation failure, if any. */
  readonly error: string
  /** Translate the panel's locale keys. */
  readonly t: (key: ProductPanelKey) => string
}

/** Injected generated Remote namespace used by the mounted panel. */
type ProductRemote = ClientRemote['documentProducts']

const actionLabel: Readonly<Record<ProductAction, ProductPanelKey>> = { submit: 'submit', approve: 'approve', reject: 'reject', revise: 'revise', publish: 'publish', archive: 'archive' }

/** Render products with provenance citations, history, and only currently legal controls. @param props - products, action dispatcher, and locale translator. @returns accessible document review panel. */
export function DocumentProducts({ products, legalActions, onAction, onGenerate, available, pending, error, t }: DocumentProductsProps) {
  return <section aria-label={t('title')} data-locale={NS}>
    <h2>{t('title')}</h2>
    {error && <p role="alert">{error}</p>}
    {pending && <p role="status">{t('pending')}</p>}
    <button type="button" disabled={pending || !available} onClick={onGenerate}>{t('generate')}</button>
    {products.length === 0 ? <p>{t('empty')}</p> : products.map(product => <article key={product.id}>
      <h3>{product.title}</h3><p>{t(product.state)}</p><p>{t('version')}: {product.version}</p>
      <div><h4>{t('sections')}</h4>{product.sections.map((section, index) => <section key={`${section.heading}-${index}`}><h5>{section.heading}</h5><p>{section.body}</p></section>)}<p>{product.body}</p></div>
      <div><h4>{t('citations')}</h4><ul>{product.citations.map((citation, index) => <li key={`${citation.documentId}-${citation.ordinal}-${index}`}>{citation.claim}: {citation.text} <small>{citation.documentId} / {citation.ordinal} / {citation.charStart}-{citation.charEnd}</small></li>)}</ul></div>
      <div><h4>{t('history')}</h4><ol>{product.history.map((event, index) => <li key={`${event.at}-${index}`}>{t(event.from)} → {t(event.to)} · {event.at} · {t('actor')}: {event.actor}</li>)}</ol></div>
      <div><h4>{t('actions')}</h4>{legalActions(product.state).map(action => <button key={action} type="button" disabled={pending} onClick={() => onAction(product.id, action)}>{t(actionLabel[action])}</button>)}</div>
    </article>)}
  </section>
}

/** Selects a session, loads its products, and dispatches generated Remote operations. @param props - injected Remote face, session selector, and translator. @returns the session-backed product panel. */
export function DocumentProductsPanel({ remote, useSessions, t }: {
  readonly remote: ProductRemote
  readonly useSessions: UseSessions
  readonly t: (key: ProductPanelKey) => string
}) {
  const sessions = useSessions(state => state.ids)
  const [sessionId, setSessionId] = useState<SessionId | undefined>(sessions[0])
  const [products, setProducts] = useState<readonly DocumentProduct[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async (id: SessionId) => {
    const result = await remote.list(id)
    if (!result.ok) throw result.error
    setProducts(result.value)
  }, [remote])
  useEffect(() => {
    if (!sessions.length) {
      setSessionId(undefined)
      setProducts([])
      setPending(false)
      return
    }
    if (!sessionId || !sessions.includes(sessionId)) setSessionId(sessions[0])
  }, [sessions, sessionId])
  useEffect(() => {
    if (!sessionId) return
    let active = true
    setPending(true)
    setProducts([])
    setError('')
    void remote.list(sessionId).then(result => {
      if (!active) return
      if (!result.ok) { setError(String(result.error)); return }
      setProducts(result.value)
    }).catch(reason => { if (active) setError(String(reason)) }).finally(() => { if (active) setPending(false) })
    return () => { active = false }
  }, [remote, sessionId])
  const act = async (id: DocumentProduct['id'], action: ProductAction) => {
    if (!sessionId) return
    setPending(true); setError('')
    try {
      const result = await remote.act({ sessionId, id, action, actor: 'client', at: new Date().toISOString() })
      if (!result.ok) throw result.error
      await refresh(sessionId)
    } catch (reason) { setError(String(reason)) } finally { setPending(false) }
  }
  const generate = async () => {
    if (!sessionId) return
    setPending(true); setError('')
    try {
      const result = await remote.generate({ sessionId, input: { kind: '灾害预警产品', stationId: 'ha-hx-01', from: '2026-09-23', to: '2026-09-23' } })
      if (!result.ok) throw result.error
      await refresh(sessionId)
    } catch (reason) { setError(String(reason)) } finally { setPending(false) }
  }
  return <div>
    <label>{t('session')} <select aria-label={t('session')} value={sessionId ?? ''} onChange={event => setSessionId(sessions.find(id => id === event.currentTarget.value))}>
      {sessions.map(id => <option key={id} value={id}>{id}</option>)}
    </select></label>
    <DocumentProducts products={products} legalActions={legalProductActions}
      onAction={(id, action) => { void act(id, action) }} onGenerate={() => { void generate() }}
      available={sessionId !== undefined} pending={pending} error={error} t={t} />
  </div>
}

/** Session document list, generation, and review controls. */
import { useCallback, useEffect, useState } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { DocumentProduct, ProductAction } from '@deepseek-ai/dsh-document-products'
import type { ProductPanelKey } from './locales.ts'
import { NS } from './locales.ts'

type ActionableProduct = DocumentProduct & { readonly legalActions: readonly ProductAction[] }

/** Compact glyph shown beside the document products panel name. @returns panel glyph. */
export function DocumentProductsIcon() {
  return <span aria-hidden="true">文</span>
}

/** Product records, legal actions, progress, errors, and localized panel controls. */
export interface DocumentProductsProps {
  /** Current session's product records and host-authorized actions. */
  readonly products: readonly ActionableProduct[]
  /** Apply an action to a product when a selected session is available. */
  readonly onAction?: (productId: DocumentProduct['id'], action: ProductAction) => void
  readonly onEdit?: (productId: DocumentProduct['id'], body: string) => void
  readonly onGenerate?: () => void
  /** Whether a remote operation is in progress. */
  readonly pending: boolean
  /** Latest visible operation failure, if any. */
  readonly error: string
  /** Translate the panel's locale keys. */
  readonly t: (key: ProductPanelKey) => string
}

/** Injected generated Remote namespace used by the mounted panel. */
type ProductRemote = ClientRemote['documentProducts']

const actionLabel: Readonly<Record<ProductAction, ProductPanelKey>> = { edit: 'edit', submit: 'submit', approve: 'approve', reject: 'reject', revise: 'revise', publish: 'publish', archive: 'archive' }

/** Render products with host-authorized controls, provenance citations, and history.
 * @param props - products, action dispatcher, and locale translator.
 * @returns accessible document review panel.
 */
export function DocumentProducts({ products, onAction, onEdit, onGenerate, pending, error, t }: DocumentProductsProps) {
  const [editing, setEditing] = useState<DocumentProduct['id'] | undefined>()
  const [editedBody, setEditedBody] = useState('')
  return <section aria-label={t('title')} data-locale={NS}>
    <h2>{t('title')}</h2>
    {error && <p role="alert">{error}</p>}
    {pending && <p role="status">{t('pending')}</p>}
    {onGenerate && <button type="button" disabled={pending} onClick={onGenerate}>{t('generate')}</button>}
    {products.length === 0 ? <p>{t('empty')}</p> : products.map(product => <article key={product.id}>
      <h3>{product.title}</h3><p>{t(product.state)}</p><p>{t('version')}: {product.version}</p>
      <div><h4>{t('sections')}</h4>{product.sections.map((section, index) => <section key={`${section.heading}-${index}`}><h5>{section.heading}</h5><p>{section.body}</p></section>)}<p>{product.body}</p></div>
      <div><h4>{t('citations')}</h4><ul>{product.citations.map((citation, index) => <li key={`${citation.documentId}-${citation.ordinal}-${index}`}>{citation.claim}: {citation.text} <small>{citation.documentId} / {citation.ordinal} / {citation.charStart}-{citation.charEnd}</small></li>)}</ul></div>
      <div><h4>{t('history')}</h4><ol>{product.history.map((event, index) => <li key={`${event.at}-${index}`}>{t(event.from)} → {t(event.to)} · {event.at} · {t('actor')}: {event.actor}</li>)}</ol></div>
      {onAction && <div><h4>{t('actions')}</h4>{product.legalActions.map(action => <button key={action} type="button" disabled={pending} onClick={() => {
        if (action === 'edit') { setEditing(product.id); setEditedBody(product.body) }
        else onAction(product.id, action)
      }}>{t(actionLabel[action])}</button>)}</div>}
      {editing === product.id && <form onSubmit={(event) => {
        event.preventDefault()
        onEdit?.(product.id, editedBody)
        setEditing(undefined)
      }}>
        <label>{t('editBody')}<textarea value={editedBody} onChange={event => setEditedBody(event.currentTarget.value)} /></label>
        <button type="submit" disabled={pending}>{t('save')}</button>
        <button type="button" disabled={pending} onClick={() => setEditing(undefined)}>{t('cancel')}</button>
      </form>}
    </article>)}
  </section>
}

/** Selects a session, loads its products, and dispatches generated Remote operations.
 * @param props - injected Remote face, session selector, and translator.
 * @returns the session-backed product panel.
 */
export function DocumentProductsPanel({ remote, useSessions, t }: {
  readonly remote: ProductRemote
  readonly useSessions: UseSessions
  readonly t: (key: ProductPanelKey) => string
}) {
  const sessions = useSessions(state => state.ids)
  const [sessionId, setSessionId] = useState<SessionId | undefined>(sessions[0])
  const [products, setProducts] = useState<readonly ActionableProduct[]>([])
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
    void remote.list(sessionId).then((result) => {
      if (!active) return
      if (!result.ok) { setError(String(result.error)); return }
      setProducts(result.value)
    }).catch((reason) => { if (active) setError(String(reason)) }).finally(() => { if (active) setPending(false) })
    return () => { active = false }
  }, [remote, sessionId])
  const act = async (targetSession: SessionId, id: DocumentProduct['id'], action: ProductAction, body?: string) => {
    setPending(true); setError('')
    try {
      const result = await remote.act({ sessionId: targetSession, id, action, actor: 'client', at: new Date().toISOString(), ...(body === undefined ? {} : { body }) })
      if (!result.ok) throw result.error
      await refresh(targetSession)
    } catch (reason) { setError(String(reason)) } finally { setPending(false) }
  }
  const generate = async (targetSession: SessionId) => {
    setPending(true); setError('')
    try {
      const result = await remote.generate({ sessionId: targetSession, input: { kind: '灾害预警产品', stationId: 'hl-wc-01', from: '2026-09-23', to: '2026-09-23' } })
      if (!result.ok) throw result.error
      await refresh(targetSession)
    } catch (reason) { setError(String(reason)) } finally { setPending(false) }
  }
  return <div>
    {!sessions.length && <p>{t('noSession')}</p>}
    <label>{t('session')} <select aria-label={t('session')} disabled={!sessions.length} value={sessionId ?? ''} onChange={event => setSessionId(sessions.find(id => id === event.currentTarget.value))}>
      {sessions.map(id => <option key={id} value={id}>{id}</option>)}
    </select></label>
    <DocumentProducts products={products}
      {...(sessionId ? {
        onAction: (id: DocumentProduct['id'], action: ProductAction) => { void act(sessionId, id, action) },
        onGenerate: () => { void generate(sessionId) },
        onEdit: (id: DocumentProduct['id'], body: string) => { void act(sessionId, id, 'edit', body) },
      } : {})}
      pending={pending} error={error} t={t} />
  </div>
}

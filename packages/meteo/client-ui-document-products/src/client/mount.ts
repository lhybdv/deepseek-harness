/** Register the document product panel and its bilingual copy. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import productRemote from '@deepseek-ai/dsh-api-document-products/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { DocumentProductsIcon, DocumentProductsPanel } from './DocumentProducts.tsx'
import { NS, en, zh } from './locales.ts'

/** Client service required to register translations, slots, and the generated Remote face. */
export const inject = ['locale', 'slots', 'remote']
const PANEL_ID = 'meteo-document-products'

/** Mount the generated Remote face and register the localized panel slots. @param ctx - client context providing locale, slots, and Remote services. @returns after the Remote face is mounted and slot registrations are installed. */
export async function apply(ctx: Context): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(productRemote)
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'document-products: dictionaries')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => t('title'), locale: NS },
    DocumentProductsIcon,
  )), 'document-products: panel row')
  const remote: Pick<ClientRemote, 'documentProducts'> = ctx.remote
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ remote: remote.documentProducts }) },
    DocumentProductsPanel,
  )), 'document-products: panel body')
  ctx.effect(() => disposeRemote)
}

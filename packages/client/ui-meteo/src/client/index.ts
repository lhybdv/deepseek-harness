/**
 * Browser half: the corpus page and the citation tab, both over the `meteo`
 * Remote namespace.
 *
 * Two surfaces share one namespace and one bound face. The page is a global
 * panel — the index is not session state, so the row sits in `sidebar.panellist`
 * and its body in `main`, and it is reachable from any session. The citation tab
 * is the opposite: a consultation cites one chunk, so it is a right-Sidebar tab
 * type opened by an address that carries the document and the ordinal, and any
 * number of them can be open at once.
 *
 * Composition is the off switch for both: a cordis.yml without this row has no
 * corpus page, no citation type, and no dictionary.
 *
 * @module @deepseek-ai/dsh-client-ui-meteo
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { CitationTab } from './CitationTab.tsx'
import { CorpusPage } from './CorpusPage.tsx'
import { CITATION_ID, citationDefinition } from './definition.ts'
import { createMeteoFace } from './face.ts'
import { MeteoPanelIcon } from './MeteoPanelIcon.tsx'
import { en, zh } from './locales.ts'

export type { CitationTarget } from './address.ts'
export type { CorpusPageInjected, CorpusPageProps } from './CorpusPage.tsx'
export type { CitationTabInjected, CitationTabProps } from './CitationTab.tsx'
export type { MeteoKey } from './locales.ts'
export type { MeteoFace, MeteoRemote } from './face.ts'

/** This package's copy namespace. */
const NS = 'meteo'

/**
 * The panel id, shared by the row in the panel list and the body in `main`. The
 * Sidebar addresses a panel by this one value, so the two registrations cannot
 * drift.
 */
const PANEL_ID = 'meteo-corpus'

/** Position of the corpus row among the shipped panel rows. */
const PANEL_ORDER = 30

/** Required browser services: the seats, copy, the right Sidebar, and the `meteo` namespace. */
export const inject = [
  'slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.meteo',
]

/**
 * Client plugin body: register the dictionaries, the citation type, the panel
 * row, the page, and the citation body.
 * @param ctx - client root context carrying the seats and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-meteo: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(citationDefinition(t)), 'ui-meteo: citation type')

  const meteo = createMeteoFace(ctx.remote)
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('page.panel'), locale: NS },
    MeteoPanelIcon,
  )), 'ui-meteo: corpus panel row')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    {
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: () => ({ meteo }),
    },
    CorpusPage,
  )), 'ui-meteo: corpus page')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: CITATION_ID, locale: NS, inject: () => ({ meteo }) },
    CitationTab,
  )), 'ui-meteo: citation body')
}

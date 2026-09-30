// @vitest-environment jsdom
/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The tab registry is real, because "registered" means what it says a type is;
 * the seat, locale, right-Sidebar, and Remote faces are recorders, because what
 * matters here is what was handed to them — the panel row, the page under the
 * same id, and the citation body under the type's id — and that every
 * registration is gone after dispose, which is what makes a reload safe.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CitationTab } from '../src/client/CitationTab.tsx'
import { CorpusPage } from '../src/client/CorpusPage.tsx'
import { CITATION_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { MeteoPanelIcon } from '../src/client/MeteoPanelIcon.tsx'
import { en, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

/** What one seat registration carried, as the recorder saw it. */
interface Recorded {
  readonly name: string
  readonly key: string | undefined
  readonly id: string | undefined
  readonly order: number | undefined
  readonly label: unknown
  readonly locale: string | undefined
  readonly component: unknown
  readonly inject: unknown
}

/** Boot the client half over recording seats. */
async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const opened: string[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      registered.push({ ...options, component })
      return () => { registered.splice(registered.indexOf(registered[registered.length - 1]!), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    // Copy is the dictionary's contract; the key stands in for the translation.
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const meteo = { corpusList: vi.fn() }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('sidebarRight', { openResource: (address: string) => { opened.push(address) } } as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('remote', { meteo } as never)
  ctx.provide('remote.meteo', meteo as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, opened, fiber }
}

describe('ui-meteo apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, the panel row, the page, and the citation body', async () => {
    const { tabs, registered, dictionaries } = await boot()
    expect(tabs.get(CITATION_KIND)?.id).toBe('@deepseek-ai/dsh-client-ui-meteo/citation')
    expect(dictionaries.get('meteo')).toEqual({ zh, en })
    expect(registered.map(entry => [entry.name, entry.key ?? entry.id, entry.component])).toEqual([
      ['sidebar.panellist', 'meteo-corpus', MeteoPanelIcon],
      ['main', 'meteo-corpus', CorpusPage],
      ['sidebar.right.pane.tab', '@deepseek-ai/dsh-client-ui-meteo/citation', CitationTab],
    ])
    expect(registered.map(entry => entry.order)).toEqual([30, undefined, undefined])
    expect(registered.map(entry => entry.locale)).toEqual(['meteo', 'meteo', 'meteo'])
    expect(typeof registered[1]?.inject).toBe('function')
  })

  it('labels the panel row from the namespace, read at draw time', async () => {
    const { registered } = await boot()
    const label = registered[0]?.label as () => string
    // The translator is the recorder's key echo, so the label proves the row
    // asked the namespace rather than embedding a string.
    expect(label()).toBe('page.panel')
  })

  it('draws the panel glyph at the edge length the row asks for', async () => {
    const props = { size: 18, active: true } as unknown as PropsRuntime<'sidebar.panellist'>
    const view = render(<MeteoPanelIcon {...props} />)
    expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('18')
    expect(view.container.querySelector('[data-active="true"]')).toBeTruthy()
  })

  it('binds the page and the citation body to one namespace face', async () => {
    const { registered } = await boot()
    const page = (registered[1]?.inject as () => { meteo: unknown; openCitation?: unknown })()
    const tab = (registered[2]?.inject as () => { meteo: unknown })()
    expect(page.meteo).toBeDefined()
    expect(page.meteo).toBe(tab.meteo)
    // The page carries no citation opener: the right-Sidebar seats exist only
    // under a session surface, and this panel replaces the conversation.
    expect(page.openCitation).toBeUndefined()
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(CITATION_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})

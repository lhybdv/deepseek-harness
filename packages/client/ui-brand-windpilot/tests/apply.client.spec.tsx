// @vitest-environment jsdom
/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * Every seat is generic and declared by the shell, so what is asserted here is
 * the fill: one occupant per seat, each under that seat's own name, each bound to
 * this package's copy namespace, and all of them gone after dispose — which is what
 * makes composing the brand out of `cordis.yml` a real off switch.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.ts'
import { WindPilotHeadline, WindPilotHeroMark, WindPilotName, WindPilotSidebarMark, WindPilotTeamFooter } from '../src/client/WindPilotBrand.tsx'
import { en, NS, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

/** What one seat registration carried, as the recorder saw it. */
interface Recorded {
  readonly name: string
  readonly locale: string | undefined
  readonly component: unknown
}

/** Boot the client half over recording seats. */
async function boot() {
  const ctx = new Context()
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => {
        registered.splice(registered.indexOf(entry), 1)
      }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    // Copy is the dictionary's contract; the key stands in for the translation.
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => {
        dictionaries.delete(ns)
      }
    }),
  }
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { registered, dictionaries, fiber }
}

describe('ui-brand-windpilot apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('fills the four generic seats and registers its dictionaries', async () => {
    const { registered, dictionaries } = await boot()
    expect(registered.map(entry => [entry.name, entry.component])).toEqual([
      ['conversation.hero.headline', WindPilotHeadline],
      ['sidebar.brand.mark', WindPilotSidebarMark],
      ['sidebar.brand.name', WindPilotName],
      ['conversation.hero.brand.mark', WindPilotHeroMark],
      ['conversation.hero.footer', WindPilotTeamFooter],
    ])
    expect(registered.map(entry => entry.locale)).toEqual([NS, NS, NS, NS, NS])
    expect(dictionaries.get(NS)).toEqual({ zh, en })
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})

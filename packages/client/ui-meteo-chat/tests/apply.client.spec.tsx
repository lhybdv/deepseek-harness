// @vitest-environment jsdom
/**
 * The plugin body: the dictionaries and the one keyed card per meteo tool,
 * every registration taken back when the plugin goes (which is what makes a
 * reload safe), and the host-side spine staying inert.
 */
import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { MeteoConsultCard } from '../src/client/MeteoConsultCard.tsx'
import { MeteoFocusCard } from '../src/client/MeteoFocusCard.tsx'
import { MeteoLookupCard } from '../src/client/MeteoLookupCard.tsx'
import { apply, inject } from '../src/client/index.ts'
import { NS, en, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

/** One keyed registration, as the recording seat saw it. */
interface Recorded {
  readonly name: string
  readonly key: string
  readonly locale: string
  readonly component: unknown
}

/** Boot the client half over recording seats, returning the teardown too. */
function boot(): {
  registered: Recorded[]
  injected: string[]
  labels: string[]
  dictionaries: Map<string, unknown>
  dispose: () => void
} {
  const registered: Recorded[] = []
  const injected: string[] = []
  const labels: string[] = []
  const dictionaries = new Map<string, unknown>()
  const teardown: Array<() => void> = []

  const register = (options: Omit<Recorded, 'component'>, component: unknown): (() => void) => {
    registered.push({ ...options, component })
    return () => {
      registered.splice(registered.findIndex(entry => entry.component === component), 1)
    }
  }
  const ctx = {
    effect: (callback: () => () => void, label: string) => {
      labels.push(label)
      const disposer = callback()
      teardown.push(disposer)
      return disposer
    },
    slots: {
      inject: (name: string, callback: () => () => void) => {
        injected.push(name)
        return callback()
      },
      register,
    },
    locale: {
      register: (ns: string, dicts: unknown) => {
        dictionaries.set(ns, dicts)
        return () => {
          dictionaries.delete(ns)
        }
      },
    },
  } as unknown as ClientContext

  apply(ctx)
  return {
    registered,
    injected,
    labels,
    dictionaries,
    dispose: () => {
      for (const disposer of teardown) disposer()
    },
  }
}

describe('ui-meteo-chat apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('requires the slot seat and the namespace copy', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the dictionary and one card per meteo tool', () => {
    const { registered, injected, labels, dictionaries } = boot()
    expect(dictionaries.get(NS)).toEqual({ zh, en })
    expect(injected).toEqual(['tool.call.toolview', 'tool.call.toolview', 'tool.call.toolview'])
    expect(registered).toEqual([
      { name: 'tool.call.toolview', key: 'meteo_consult', locale: NS, component: MeteoConsultCard },
      { name: 'tool.call.toolview', key: 'meteo_station_lookup', locale: NS, component: MeteoLookupCard },
      { name: 'tool.call.toolview', key: 'meteo_set_focus', locale: NS, component: MeteoFocusCard },
    ])
    expect(labels).toEqual([
      'ui-meteo-chat: dictionaries',
      'ui-meteo-chat: consultation card',
      'ui-meteo-chat: station lookup card',
      'ui-meteo-chat: session focus card',
    ])
  })

  it('takes every registration back when the plugin is disposed', () => {
    const booted = boot()
    booted.dispose()
    expect(booted.registered).toEqual([])
    expect(booted.dictionaries.size).toBe(0)
  })
})

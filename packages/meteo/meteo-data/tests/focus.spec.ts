/**
 * Tests for the cross-turn session focus: what a session answers about the place
 * and crop it is working on, how a write replaces that answer for every later
 * read, and what happens when the package that owns the answer is unloaded.
 *
 * The focus is a session projection, so these cases run the real session log and
 * the real projection registry: a focus only counts when it survives a fold from
 * the log rather than living in provider memory.
 */

import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { LocalMeteoData, appendFocus, readFocus } from '@deepseek-ai/dsh-meteo-data'
import type { MeteoDataConfig } from '@deepseek-ai/dsh-meteo-data'

const CONFIG: MeteoDataConfig = {
  source: 'fixture',
  fixtureDir: fileURLToPath(new URL('../fixtures/', import.meta.url)),
  timeoutMs: 15_000,
}

const contexts: Context[] = []
let created = 0

/** A context whose session log, projection registry, and data provider are all live. */
async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = ctx.plugin(LocalMeteoData, CONFIG)
  await fiber.await()
  created += 1
  return { ctx, session: ctx.sessions.create(SessionId(`meteo-focus-${String(created)}`)), fiber }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('session focus', () => {
  it('starts a session with no focus', async () => {
    const { ctx, session } = await harness()
    expect(readFocus(ctx, { session })).toBeNull()
  })

  it('answers with the focus the session last wrote', async () => {
    const { ctx, session } = await harness()
    appendFocus(session, { stationId: 'hl-wc-01', crop: '玉米', updatedAt: 1_759_000_000_000 })
    expect(readFocus(ctx, { session })).toEqual({
      stationId: 'hl-wc-01',
      crop: '玉米',
      updatedAt: 1_759_000_000_000,
    })
    appendFocus(session, { crop: '大豆', updatedAt: 1_759_003_600_000 })
    expect(readFocus(ctx, { session })).toEqual({ crop: '大豆', updatedAt: 1_759_003_600_000 })
  })

  it('releases the focus when the session writes null', async () => {
    const { ctx, session } = await harness()
    appendFocus(session, { stationId: 'ln-ct-03', updatedAt: 1_759_000_000_000 })
    expect(readFocus(ctx, { session })).toEqual({ stationId: 'ln-ct-03', updatedAt: 1_759_000_000_000 })
    appendFocus(session, null)
    expect(readFocus(ctx, { session })).toBeNull()
  })

  it('leaves the focus alone across events that carry none', async () => {
    const { ctx, session } = await harness()
    appendFocus(session, { stationId: 'jl-ys-06', crop: '水稻', updatedAt: 1_759_000_000_000 })
    session.append('turn/start', { turn: 1 })
    expect(readFocus(ctx, { session })).toEqual({
      stationId: 'jl-ys-06',
      crop: '水稻',
      updatedAt: 1_759_000_000_000,
    })
  })

  it('keeps each session on its own focus', async () => {
    const first = await harness()
    const second = await harness()
    appendFocus(first.session, { stationId: 'hl-wc-01', updatedAt: 1_759_000_000_000 })
    appendFocus(second.session, { crop: '大豆', updatedAt: 1_759_000_000_001 })
    expect(readFocus(first.ctx, { session: first.session })).toEqual({
      stationId: 'hl-wc-01',
      updatedAt: 1_759_000_000_000,
    })
    expect(readFocus(second.ctx, { session: second.session })).toEqual({
      crop: '大豆',
      updatedAt: 1_759_000_000_001,
    })
  })

  it('has no focus to report once the provider is unloaded', async () => {
    const { ctx, session, fiber } = await harness()
    appendFocus(session, { stationId: 'hl-wc-01', updatedAt: 1_759_000_000_000 })
    expect(readFocus(ctx, { session })).toEqual({ stationId: 'hl-wc-01', updatedAt: 1_759_000_000_000 })
    await fiber.dispose()
    expect(readFocus(ctx, { session })).toBeNull()
  })

  it('refuses a second data provider in the same context', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const first = new LocalMeteoData(ctx, CONFIG)
    expect(first).toBeInstanceOf(LocalMeteoData)
    expect(() => new LocalMeteoData(ctx, CONFIG)).toThrow()
  })
})

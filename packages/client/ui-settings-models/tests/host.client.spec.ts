/**
 * Host half of the models settings plugin: the onboarding switch is projected
 * into every served index as one `globalThis` assignment the Client half reads.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_ONBOARDING, ONBOARDING_GLOBAL, apply } from '../src/index.ts'

/** Collect the injection table the way an index render or boot payload does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

describe('ui-settings-models host', () => {
  it('projects the deployment default when the row carries no config', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(collect(ctx)).toEqual([{ kind: 'global', name: ONBOARDING_GLOBAL, value: DEFAULT_ONBOARDING }])
  })

  it('projects a disabled switch', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply }, { onboarding: false })
    await fiber.await()
    expect(collect(ctx)).toEqual([{ kind: 'global', name: ONBOARDING_GLOBAL, value: false }])
  })

  it('drops the injected row with the plugin fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply }, { onboarding: false })
    await fiber.await()
    await fiber.dispose()
    expect(collect(ctx)).toEqual([])
  })
})

import { SystemPrompt } from '../../../core/system-prompt/src/index.ts'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  Config, apply,
} from '@deepseek-ai/dsh-client-locale'


describe('locale host', () => {
  it('defaults answer language to Chinese and contributes the selected language to the request context', async () => {
    const ctx = new Context()
    ctx.provide('settings', { configure: () => () => {} } as never)
    await ctx.plugin(SystemPrompt)
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.config)).toEqual({ answerLanguage: 'zh' })
    expect((await ctx.systemPrompt.assemble()).contexts).toContainEqual({
      name: 'answer-language',
      text: '请使用中文回答。',
    })
    await configuration.update({ answerLanguage: 'en' })
    expect((await ctx.systemPrompt.assemble()).contexts).toContainEqual({
      name: 'answer-language',
      text: 'Answer in English.',
    })
    await expect(configuration.update({ answerLanguage: 'fr' })).rejects.toThrow()
    await fiber.dispose()
  })
})
it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage((ctx) => {
  ctx.provide('systemPrompt', { context: () => () => {} } as never)
  return ctx.plugin(HostPlugin)
}))

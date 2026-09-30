/**
 * Behaviour tests for the plugin itself: the config bounds refused at load, the
 * three tools it registers and how they schedule, and the guidance section that
 * only speaks to a scope which can actually call them.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  DEFAULT_CONSULT_LIMIT,
  DEFAULT_FORECAST_HOURS,
  DEFAULT_MAX_CLARIFICATION_CANDIDATES,
  DEFAULT_MAX_CONSULT_LIMIT,
  DEFAULT_MAX_SERIES_ROWS,
  DEFAULT_SNIPPET_CHARS,
  DEFAULT_TOOL_TIMEOUT_MS,
  consultGuidance,
} from '@deepseek-ai/dsh-tool-meteo'
import type { MeteoLimits } from '@deepseek-ai/dsh-tool-meteo'
import * as ToolMeteo from '@deepseek-ai/dsh-tool-meteo'
import { mountSeams, mountTools } from './harness.ts'

const PERSONA = 'You are an AI agent powered by DeepSeek Harness.'

const DEFAULT_LIMITS: MeteoLimits = {
  defaultLimit: DEFAULT_CONSULT_LIMIT,
  maxLimit: DEFAULT_MAX_CONSULT_LIMIT,
  forecastHours: DEFAULT_FORECAST_HOURS,
  maxClarificationCandidates: DEFAULT_MAX_CLARIFICATION_CANDIDATES,
  maxSnippetChars: DEFAULT_SNIPPET_CHARS,
  maxSeriesRows: DEFAULT_MAX_SERIES_ROWS,
  timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
}

/** Create a real per-agent scope over the mounted tools. */
async function guidanceScope(ctx: Context) {
  const key = {}
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, key)
  }, { inject: ['tools', 'systemPrompt'] }))
  return { key, scope }
}

describe('tool-meteo config', () => {
  it.each([
    ['defaultLimit', 0],
    ['maxLimit', -1],
    ['forecastHours', 1.5],
    ['maxClarificationCandidates', 0],
    ['maxSnippetChars', 0],
    ['maxSeriesRows', -2],
    ['timeoutMs', 0.5],
  ])('refuses a non-positive or fractional %s at load', async (name, value) => {
    const ctx = await mountSeams()
    await expect(ctx.plugin(ToolMeteo, { [name]: value })).rejects
      .toThrow(new RegExp(`tool-meteo: ${name} must be a positive integer`))
  })

  it('refuses a default corpus window larger than the bound', async () => {
    const ctx = await mountSeams()
    await expect(ctx.plugin(ToolMeteo, { defaultLimit: 30, maxLimit: 20 })).rejects
      .toThrow('tool-meteo: defaultLimit must not exceed maxLimit')
  })

  it('states the window and horizon the config grants the model in each description', async () => {
    const { ctx } = await mountTools({ defaultLimit: 2, maxLimit: 3, forecastHours: 24, timeoutMs: 1500 })
    expect(ctx.tools.get('meteo_consult')?.description).toContain('six steps')

    expect(ctx.tools.get('meteo_consult')?.timeoutMs).toBe(1500)
    expect(ctx.tools.get('meteo_station_lookup')?.timeoutMs).toBe(1500)
    expect(ctx.tools.get('meteo_set_focus')?.timeoutMs).toBe(1500)
  })

  it('registers three consultation tools and schedules the write alone', async () => {
    const { ctx } = await mountTools()
    const { scope } = await guidanceScope(ctx)
    const assembly = await ctx.systemPrompt.assemble({ scope })
    expect(assembly.tools.map(tool => tool.name).sort())
      .toEqual(['meteo_consult', 'meteo_set_focus', 'meteo_station_lookup'])
    const mode = (name: string, args: unknown = {}) => ctx.tools.executionMode({
      signal: new AbortController().signal,
      callId: ToolCallId(`call-mode-${name}`),
      name,
      arguments: args,
    })
    expect(mode('meteo_consult', { question: 'x' })).toEqual({ kind: 'parallel' })
    expect(mode('meteo_station_lookup')).toEqual({ kind: 'parallel' })
    expect(mode('meteo_set_focus')).toEqual({ kind: 'exclusive' })
    await scope.dispose()
  })

  it('withdraws its tools and its guidance once the plugin is disposed', async () => {
    const ctx = await mountSeams()
    const fiber = await ctx.plugin(ToolMeteo, {})
    const { scope } = await guidanceScope(ctx)
    await fiber.dispose()
    expect(ctx.tools.get('meteo_consult')).toBeUndefined()
    expect(ctx.tools.get('meteo_station_lookup')).toBeUndefined()
    expect(ctx.tools.get('meteo_set_focus')).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope }))).toBe(PERSONA)
  })
})

describe('tool:meteo guidance', () => {
  it('speaks to a scope that can call the consultation', async () => {
    const { ctx } = await mountTools()
    const { scope } = await guidanceScope(ctx)
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope }))
    expect(prompt.startsWith(PERSONA)).toBe(true)
    expect(prompt).toContain('meteo_consult before answering')
    expect(prompt).toContain('ask_user_question')
    expect(prompt).toContain('the window holds 6 chunks by default and 20 at the most.')
    await scope.dispose()
  })

  it('falls silent for a scope whose tools are hidden', async () => {
    const { ctx } = await mountTools()
    const { key, scope } = await guidanceScope(ctx)
    const release = scope.ctx.tools.restrict({ allow: [] })
    try {
      const assembly = await ctx.systemPrompt.assemble({ scope: key })
      expect(assembly.tools).toEqual([])
      expect(renderPrompt(assembly)).toBe(PERSONA)
    } finally {
      release()
      await scope.dispose()
    }
  })

  it('names the window the deployment configured', () => {
    expect(consultGuidance({ ...DEFAULT_LIMITS, defaultLimit: 2, maxLimit: 3 }))
      .toContain('the window holds 2 chunks by default and 3 at the most.')
  })
})

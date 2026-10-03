/** Synthesis provider routing, disposal cancellation, and service shutdown. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import SpeechSynthesis from '../src/index.ts'
import type { SpeechSynthesisProvider, SpeechSynthesisProviderId } from '../src/types.ts'
function provider(synthesize: SpeechSynthesisProvider['synthesize'] = async () => new Uint8Array([1])): SpeechSynthesisProvider {
  return { info: { id: 'coze' as SpeechSynthesisProviderId, name: 'test', location: 'cloud' }, synthesize }
}
it('routes text, rejects duplicate and missing providers, then allows registration disposal', async () => {
  const ctx = new Context(), service = new SpeechSynthesis(ctx, { defaultProvider: 'coze' })
  const synthesize = vi.fn(async () => new Uint8Array([2]))
  const dispose = service.register(provider(synthesize))
  expect(() => service.register(provider())).toThrow('already registered')
  expect([...await service.synthesize({ text: 'hello' }, new AbortController().signal)]).toEqual([2])
  expect(synthesize).toHaveBeenCalledWith({ text: 'hello' }, expect.any(AbortSignal))
  await dispose(); await dispose()
  await expect(service.synthesize({ text: 'again' }, new AbortController().signal)).rejects.toThrow('unavailable')
  await ctx.fiber.dispose()
})
it('cancels accepted work and joins provider settlement on removal', async () => {
  const ctx = new Context(), service = new SpeechSynthesis(ctx, { defaultProvider: 'coze' })
  const gate = Promise.withResolvers<Uint8Array<ArrayBuffer>>()
  let received: AbortSignal | undefined
  const dispose = service.register(provider(async (_request, signal) => { received = signal; return await gate.promise }))
  const call = service.synthesize({ text: 'hello' }, new AbortController().signal)
  await Promise.resolve()
  const removing = dispose()
  expect(received?.aborted).toBe(true)
  gate.resolve(new Uint8Array([3]))
  await removing
  await expect(call).rejects.toThrow('unloaded')
  await ctx.fiber.dispose()
})
it('rejects an already-aborted call', async () => {
  const service = new SpeechSynthesis(new Context(), { defaultProvider: 'coze' })
  service.register(provider())
  await expect(service.synthesize({ text: 'x' }, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
})

/** Synthesis Remote validates intake, encodes audio, and preserves failure and cancellation. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import SpeechSynthesis from '@deepseek-ai/dsh-text-to-speech/src/index.ts'
import type { SpeechSynthesisProviderId } from '@deepseek-ai/dsh-text-to-speech/src/types.ts'
import SpeechSynthesisController from '../src/index.ts'
const id = 'coze' as SpeechSynthesisProviderId
function fixture() {
  const ctx = new Context(), service = new SpeechSynthesis(ctx, { defaultProvider: 'coze' })
  const synthesize = vi.fn(async () => new Uint8Array([0xff, 0xfb, 0x90]))
  service.register({ info: { id, name: 'Coze', location: 'cloud' }, synthesize })
  return { api: new SpeechSynthesisController(ctx, { maxTextLength: 10 }), synthesize }
}
it('validates text and returns base64 audio bytes', async () => {
  const { api, synthesize } = fixture()
  await expect(api.synthesize({ text: '  ' }, new AbortController().signal)).rejects.toMatchObject({ code: 'speech-synthesis/invalid-text' })
  await expect(api.synthesize({ text: '01234567890' }, new AbortController().signal)).rejects.toMatchObject({ code: 'speech-synthesis/invalid-text' })
  expect(await api.synthesize({ text: '你好' }, new AbortController().signal)).toEqual({ audioBase64: '//uQ', mimeType: 'audio/mpeg' })
  expect(synthesize).toHaveBeenCalledWith({ text: '你好' }, expect.any(AbortSignal))
})
it('surfaces provider errors and caller cancellation', async () => {
  const { api, synthesize } = fixture()
  synthesize.mockRejectedValueOnce(new Error('offline'))
  await expect(api.synthesize({ text: 'hi' }, new AbortController().signal)).rejects.toMatchObject({ code: 'speech-synthesis/failed', message: 'offline' })
  await expect(api.synthesize({ text: 'hi' }, AbortSignal.abort(new Error('cancel')))).rejects.toThrow('cancel')
})
it('stringifies non-Error provider failures into typed Remote errors', async () => {
  const { api, synthesize } = fixture()
  synthesize.mockRejectedValueOnce('provider unavailable')
  await expect(api.synthesize({ text: 'hi' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'speech-synthesis/failed', message: 'provider unavailable', details: { reason: 'provider unavailable' } })
})

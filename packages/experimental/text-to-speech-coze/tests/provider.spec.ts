/** Coze request construction, credential resolution, and remote failure behavior. */
import { Context } from '@deepseek-ai/cordis'
import SpeechSynthesis from '@deepseek-ai/dsh-text-to-speech/src/index.ts'
import { afterEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals() })
async function fixture() {
  const ctx = new Context()
  await ctx.plugin(SpeechSynthesis, { defaultProvider: 'coze' })
  let credential: { value: string; source: string } | undefined = { value: 'host-secret', source: 'file' }
  ctx.provide('credentials', { resolve: async (ref: string) => ref === 'COZE_TEST' ? credential : undefined } as never)
  await ctx.plugin(Provider, { credentialRef: 'COZE_TEST', voiceId: 'voice-test', emotion: 'calm', baseUrl: 'https://stub.example/audio' })
  return { ctx, service: ctx.speechSynthesis, setCredential: (value: typeof credential) => { credential = value } }
}
it('constructs a bearer-authenticated Coze request and returns its audio bytes', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([0xff, 0xfb, 0x90])))
  vi.stubGlobal('fetch', fetcher)
  const { ctx, service } = await fixture()
  try {
    const bytes = await service.synthesize({ text: '你好' }, new AbortController().signal)
    expect([...bytes]).toEqual([255, 251, 144])
    expect(fetcher).toHaveBeenCalledWith('https://stub.example/audio', expect.objectContaining({ method: 'POST', headers: {
      Authorization: 'Bearer host-secret', Accept: 'audio/mpeg', 'Content-Type': 'application/json',
    }, body: JSON.stringify({ voice_id: 'voice-test', input: '你好', emotion: 'calm' }) }))
  } finally { await ctx.fiber.dispose() }
})
it('surfaces missing credentials and HTTP failures', async () => {
  const { ctx, service, setCredential } = await fixture()
  try {
    setCredential(undefined)
    await expect(service.synthesize({ text: '你好' }, new AbortController().signal)).rejects.toThrow('COZE_TEST')
    setCredential({ value: 'token', source: 'file' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('failed', { status: 503 })))
    await expect(service.synthesize({ text: '你好' }, new AbortController().signal)).rejects.toThrow('HTTP 503')
  } finally { await ctx.fiber.dispose() }
})
it('rejects already-cancelled requests and empty successful responses', async () => {
  const fetcher = vi.fn(async () => new Response(new ArrayBuffer(0)))
  vi.stubGlobal('fetch', fetcher)
  const { ctx, service } = await fixture()
  try {
    await expect(service.synthesize({ text: '你好' }, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(service.synthesize({ text: '你好' }, new AbortController().signal)).rejects.toThrow('empty audio')
  } finally { await ctx.fiber.dispose() }
})
it('rejects invalid deployment fields', () => {
  expect(() => Provider.Config({ voiceId: '' })).toThrow()
  expect(() => Provider.Config({ baseUrl: 'http://insecure.example' })).toThrow()
})

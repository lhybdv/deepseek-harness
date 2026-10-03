/** Authenticated speech domain methods validate audio before selecting a recognizer. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechProviderId, SpeechSegment, SpeechStreamInput } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { PeerId, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import type { SpeechAudioChunk } from '../src/types.ts'
import SpeechController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })
const id = 'sensevoice-local' as SpeechProviderId
function fixture(maxAudioBytes = 32044, maxDurationSeconds = 1) {
  const ctx = new Context(); roots.push(ctx)
  const speech = new SpeechToText(ctx, SpeechToText.Config({ defaultProvider: id, language: 'auto' }))
  const recognize = vi.fn(async () => ({ text: '你好', audioSeconds: 1, inferenceSeconds: 0.1 }))
  speech.register({ info: { id, name: 'test', location: 'host-local', languages: ['auto', 'zh', 'en', 'ja'], streaming: false }, transcribe: recognize })
  return { api: new SpeechController(ctx, { maxAudioBytes, maxDurationSeconds }), recognize }
}
function recording(): string {
  const b = Buffer.alloc(32044)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40)
  return b.toString('base64')
}

it('lists limits without inference and forwards explicit provider and language', async () => {
  const { api, recognize } = fixture()
  expect(api.catalog()).toMatchObject({ selection: { providerId: id }, maxAudioBytes: 32044, providers: [{ id }] })
  expect(recognize).not.toHaveBeenCalled()
  api.prepare(id)
  await api.cancelPreparation(id)
  const lifetime = new AbortController(), observation = api.follow(lifetime.signal)[Symbol.asyncIterator]()
  expect((await observation.next()).value).toMatchObject({ providers: [{ id, preparation: { phase: 'ready' } }] })
  lifetime.abort(); await observation.next()
  expect(await api.transcribe({ audioBase64: recording(), providerId: id, language: 'zh' }, new AbortController().signal)).toMatchObject({ text: '你好' })
  expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ language: 'zh' }), expect.any(AbortSignal))
  await api.transcribe({ audioBase64: recording() }, new AbortController().signal)
  expect(recognize).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'auto' }), expect.any(AbortSignal))
})

it('forwards an explicit download source to the registered preparation owner', async () => {
  const ctx = new Context(); roots.push(ctx)
  const speech = new SpeechToText(ctx, SpeechToText.Config({ defaultProvider: id }))
  const prepare = vi.fn()
  speech.register({ info: { id, name: 'local', location: 'host-local', languages: ['auto'], streaming: false, downloadSources: ['https://hf-mirror.com'] },
    preparation: { snapshot: () => ({ phase: 'unprepared' }), subscribe: () => () => {}, prepare, cancel: async () => {} },
    transcribe: async () => ({ text: '', audioSeconds: 0, inferenceSeconds: 0 }),
  })
  const api = new SpeechController(ctx, { maxAudioBytes: 32044, maxDurationSeconds: 1 })
  expect(api.catalog().providers[0]?.downloadSources).toEqual(['https://hf-mirror.com'])
  api.prepare(id, { downloadSource: 'https://hf-mirror.com' })
  expect(prepare).toHaveBeenCalledWith({ downloadSource: 'https://hf-mirror.com' })
})

it('rejects oversized, noncanonical, malformed and overlong audio without inference', async () => {
  const { api, recognize } = fixture()
  for (const audioBase64 of ['x'.repeat(50000), 'AAAA?', '', 'QQ==', recording() + '\n']) {
    await expect(api.transcribe({ audioBase64 }, new AbortController().signal)).rejects.toThrow()
  }
  await expect(fixture(32043).api.transcribe({ audioBase64: recording() }, new AbortController().signal)).rejects.toThrow('byte limit')
  const oversized = Buffer.concat([Buffer.from(recording(), 'base64'), Buffer.alloc(2)]).toString('base64')
  await expect(api.transcribe({ audioBase64: oversized }, new AbortController().signal)).rejects.toThrow('byte limit')
  await expect(fixture(32044, 0.5).api.transcribe({ audioBase64: recording() }, new AbortController().signal)).rejects.toThrow('exceeds')
  expect(recognize).not.toHaveBeenCalled()
})

it('preserves cancellation and reports recognizer failures', async () => {
  const { api, recognize } = fixture()
  await expect(api.configure({ language: 'zh' })).rejects.toThrow('settings service')
  await expect(api.transcribe({ audioBase64: recording() }, AbortSignal.abort(new Error('cancel')))).rejects.toThrow('cancel')
  recognize.mockRejectedValueOnce(new Error('offline'))
  await expect(api.transcribe({ audioBase64: recording() }, new AbortController().signal)).rejects.toMatchObject({ code: 'speech/transcription-failed', message: 'offline' })
  recognize.mockRejectedValueOnce('failed')
  await expect(api.transcribe({ audioBase64: recording() }, new AbortController().signal)).rejects.toMatchObject({ message: 'failed' })
})

/** Canonical base64 for one silent PCM16 batch of the given byte count. */
function pcm(bytes: number): string { return Buffer.alloc(bytes).toString('base64') }

/** The uplink the Gateway hands a stream method: the Client's items, in order. */
async function *uplink(...values: readonly SpeechAudioChunk[]): AsyncIterable<SpeechAudioChunk> {
  for (const value of values) yield value
}

/**
 * A call-derived Context carrying the invocation the Gateway builds, so
 * `this.ctx.invocation` reads here exactly as it does in a real call.
 */
function callContext(ctx: Context, items: AsyncIterable<SpeechAudioChunk>): Context {
  const invocation: RemoteInvocation = {
    request: { namespace: 'speech', method: 'transcribeStream', args: {} },
    service: 'speechController',
    peer: { id: 'peer' as PeerId, ctx, dispose: async () => {} },
    signal: new AbortController().signal,
    uplink: <In>() => items as AsyncIterable<In>,
  }
  return ctx.extend({ invocation })
}

/** One live call over a streaming recognizer, with the frames it received. */
function liveCall(chunks: readonly SpeechAudioChunk[], limits: { maxAudioBytes?: number; maxDurationSeconds?: number } = {}) {
  const ctx = new Context(); roots.push(ctx)
  const speech = new SpeechToText(ctx, SpeechToText.Config({ defaultProvider: id, language: 'auto' }))
  const frames: Uint8Array[] = []
  const live = vi.fn(async function * (input: SpeechStreamInput) {
    for await (const chunk of input.chunks) frames.push(chunk)
    yield { final: false, text: '今天' }
    yield { final: true, text: '今天有雨' }
  })
  speech.register({ info: { id, name: 'live', location: 'cloud', languages: ['auto', 'zh'], streaming: true },
    transcribe: async () => ({ text: '', audioSeconds: 0, inferenceSeconds: 0 }), transcribeStream: live })
  const api = new SpeechController(callContext(ctx, uplink(...chunks)), {
    maxAudioBytes: limits.maxAudioBytes ?? 32044, maxDurationSeconds: limits.maxDurationSeconds ?? 1,
  })
  return { api, frames, live }
}

/** Every report one live call produced. */
async function reports(iterable: AsyncIterable<SpeechSegment>): Promise<SpeechSegment[]> {
  const collected: SpeechSegment[] = []
  for await (const report of iterable) collected.push(report)
  return collected
}

it('streams live reports while forwarding each audio batch to the recognizer', async () => {
  const { api, frames, live } = liveCall([{ audioBase64: pcm(1280) }, { audioBase64: pcm(640) }])
  await expect(reports(api.transcribeStream({ language: 'zh' }, new AbortController().signal)))
    .resolves.toEqual([{ final: false, text: '今天' }, { final: true, text: '今天有雨' }])
  expect(frames.map(frame => frame.byteLength)).toEqual([1280, 640])
  expect(live).toHaveBeenCalledWith(expect.objectContaining({ language: 'zh' }), expect.any(AbortSignal))
})

it.each([
  ['noncanonical base64', 'not base64!', 'encoding'],
  ['a partial sample', pcm(3), 'alignment'],
  ['no audio at all', '', 'alignment'],
] as const)('refuses live audio carrying %s', async (_label, audioBase64, reason) => {
  const { api, frames } = liveCall([{ audioBase64 }])
  await expect(reports(api.transcribeStream({}, new AbortController().signal)))
    .rejects.toMatchObject({ code: 'speech/invalid-audio', details: { reason } })
  expect(frames).toEqual([])
})

it('refuses live audio past the configured byte and duration limits', async () => {
  await expect(reports(liveCall([{ audioBase64: pcm(1280) }], { maxAudioBytes: 1024 }).api
    .transcribeStream({}, new AbortController().signal))).rejects.toMatchObject({ message: 'Live audio exceeds the configured byte limit' })
  await expect(reports(liveCall([{ audioBase64: pcm(32000) }, { audioBase64: pcm(1280) }],
    { maxAudioBytes: 40000, maxDurationSeconds: 1 }).api
    .transcribeStream({}, new AbortController().signal))).rejects.toMatchObject({ message: 'Live transcription exceeded the configured duration' })
})

it('reports failures of live recognition and preserves cancellation', async () => {
  const ctx = new Context(); roots.push(ctx)
  const speech = new SpeechToText(ctx, SpeechToText.Config({ defaultProvider: id, language: 'auto' }))
  speech.register({ info: { id, name: 'live', location: 'cloud', languages: ['auto'], streaming: true },
    transcribe: async () => ({ text: '', audioSeconds: 0, inferenceSeconds: 0 }),
    transcribeStream: async function * () { yield { final: false, text: '' }; throw new Error('offline') },
  })
  const quiet = 'quiet' as SpeechProviderId
  speech.register({ info: { id: quiet, name: 'quiet', location: 'host-local', languages: ['auto'], streaming: false },
    transcribe: async () => ({ text: '', audioSeconds: 0, inferenceSeconds: 0 }),
  })
  const crash = 'crash' as SpeechProviderId
  speech.register({ info: { id: crash, name: 'crash', location: 'cloud', languages: ['auto'], streaming: true },
    transcribe: async () => ({ text: '', audioSeconds: 0, inferenceSeconds: 0 }),
    transcribeStream: async function * () {
      const failing = Promise.withResolvers<undefined>()
      failing.reject('failed')
      await failing.promise
    },
  })
  const api = new SpeechController(callContext(ctx, uplink()), { maxAudioBytes: 32044, maxDurationSeconds: 1 })
  await expect(reports(api.transcribeStream({}, new AbortController().signal)))
    .rejects.toMatchObject({ code: 'speech/transcription-failed', message: 'offline' })
  await expect(reports(api.transcribeStream({ providerId: crash }, new AbortController().signal)))
    .rejects.toMatchObject({ code: 'speech/transcription-failed', message: 'failed' })
  await expect(reports(api.transcribeStream({}, AbortSignal.abort(new Error('cancelled'))))).rejects.toThrow('cancelled')
  await expect(reports(api.transcribeStream({ providerId: quiet }, new AbortController().signal)))
    .rejects.toMatchObject({ code: 'speech/transcription-failed', message: 'Speech provider does not recognize live audio: quiet' })
  await expect(reports(api.transcribeStream({ providerId: 'missing' as SpeechProviderId }, new AbortController().signal)))
    .rejects.toMatchObject({ code: 'speech/transcription-failed', message: 'Speech provider is unavailable: missing' })
})

it('refuses live recognition outside a Remote call', async () => {
  const ctx = new Context(); roots.push(ctx)
  const api = new SpeechController(ctx, { maxAudioBytes: 32044, maxDurationSeconds: 1 })
  await expect(reports(api.transcribeStream({}, new AbortController().signal))).rejects.toThrow('outside a Remote call')
})

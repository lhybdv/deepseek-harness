/** Cloud registration, credential resolution, and the session a scripted service drives. */
import { Context } from '@deepseek-ai/cordis'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import { afterEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'
import { Config } from '../src/config.ts'
import { RtasrRecognizer } from '../src/session.ts'
import { signParameters } from '../src/signer.ts'
import type { SpeechSegment } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { RtasrConnect, RtasrHandlers } from '../src/socket.ts'
import { canonicalWave, FakeSocket, resultFrame } from './rtasr.fixture.ts'

const SECRET_REF = 'RTASR_TEST_SECRET'
const UNSET_REF = 'RTASR_TEST_SECRET_UNSET'

afterEach(() => { vi.unstubAllEnvs() })

/** One validated deployment configuration with deadlines short enough for tests. */
function deployment(overrides: Partial<Config> = {}): Config {
  return Config({
    appId: 'app',
    accessKeyId: 'key',
    accessKeySecretRef: SECRET_REF,
    connectTimeoutMs: 200,
    drainTimeoutMs: 50,
    ...overrides,
  })
}

/** A scripted service that accepts every connection and reacts to every send. */
function scripted(
  onSend: (data: string | Uint8Array<ArrayBuffer>, service: FakeSocket) => void,
): { connect: RtasrConnect; sockets: FakeSocket[]; urls: string[] } {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  return {
    sockets,
    urls,
    connect: (url, handlers) => {
      const socket = new FakeSocket(handlers, onSend)
      sockets.push(socket)
      urls.push(url)
      queueMicrotask(() => { socket.accept() })
      return socket
    },
  }
}

/** Answer the end marker with one final sentence and a service close. */
function completeWith(words: readonly string[]): (data: string | Uint8Array<ArrayBuffer>, service: FakeSocket) => void {
  return (data, service) => {
    if (typeof data !== 'string') return
    service.message(resultFrame({ type: 0, words }))
    service.drop()
  }
}

/** The signature the service would verify for one signed endpoint. */
function expectedSignature(url: string, secret: string): string {
  const parameters = Object.fromEntries(new URL(url).searchParams)
  delete parameters['signature']
  return signParameters(secret, parameters)
}

/** Run one recording through a recognizer wired to the given connection. */
function recognize(
  connect: RtasrConnect,
  config: Config,
  input: { audio: Uint8Array; language: string } = { audio: canonicalWave(1600), language: 'zh' },
) {
  return new RtasrRecognizer(new Context(), config, connect).transcribe(input, new AbortController().signal)
}

it('registers the cloud recognizer as immediately ready', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SpeechToText, { defaultProvider: 'iflytek-rtasr', language: 'auto' })
    const fiber = ctx.plugin(Provider, { appId: 'app', accessKeyId: 'key' })
    await fiber
    const speech = ctx.get('speechToText')!
    expect(speech.snapshot()).toMatchObject({
      providers: [{
        id: 'iflytek-rtasr', name: 'iFlytek RTASR', location: 'cloud',
        languages: ['auto', 'zh', 'en'], streaming: true, preparation: { phase: 'ready' },
      }],
      selection: { providerId: 'iflytek-rtasr', language: 'auto' },
    })
    expect(() => speech.resolve({ audio: canonicalWave(1), language: 'ja' })).toThrow('does not support language')
    expect(() => speech.resolveStream({ chunks: liveFrames([]), language: 'ja' })).toThrow('does not support language')
    // The registered provider target is the recognizer itself: without a credential it
    // refuses the recording after input validation and before any connection.
    await expect(speech.transcribe(speech.resolve({ audio: canonicalWave(1), language: 'auto' }), new AbortController().signal))
      .rejects.toThrow('access key secret is not configured')
    await expect(reports(speech.stream(speech.resolveStream({ chunks: liveFrames([1280]), language: 'auto' }), new AbortController().signal)))
      .rejects.toThrow('access key secret is not configured')
    await fiber.dispose()
    expect(speech.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it.each([['https://service.example'], ['nonsense']])('rejects the endpoint %s at load', (baseWsUrl) => {
  expect(() => Config({ appId: 'app', accessKeyId: 'key', baseWsUrl })).toThrow()
})

it('streams real-time frames and assembles the sentences the service reports', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect, sockets, urls } = scripted(completeWith(['今天', '有雨']))
  const transcript = await recognize(connect, deployment())
  expect(transcript.text).toBe('今天有雨')
  expect(transcript.audioSeconds).toBeCloseTo(0.1)
  // 1600 samples are delivered as three frames, the last one shortened, paced 40 ms apart.
  expect(transcript.inferenceSeconds).toBeGreaterThanOrEqual(0.075)
  const socket = sockets[0]!
  expect(socket.frames.map(frame => frame.length)).toEqual([1280, 1280, 640])
  expect(socket.controls).toEqual([{ end: true }])
  expect(socket.closed).toBe(true)
  const url = urls[0]!
  expect(new URL(url).searchParams.get('lang')).toBe('cn')
  expect(new URL(url).searchParams.get('samplerate')).toBe('16000')
  expect(expectedSignature(url, 'secret')).toBe(new URL(url).searchParams.get('signature'))
})

it('repeats the service session id in the end marker', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect, sockets } = scripted((data, service) => {
    if (typeof data === 'string') {
      service.message(resultFrame({ type: 0, words: ['好的'] }))
      service.drop()
      return
    }
    service.message('{"msg_type":"action","data":{"sessionId":"session-9"}}')
  })
  await recognize(connect, deployment())
  expect(sockets[0]!.controls).toEqual([{ end: true, sessionId: 'session-9' }])
})

it('keeps the sentence still being recognized when the service never finalizes it', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted((data, service) => {
    if (typeof data === 'string') { service.drop(); return }
    service.message(resultFrame({ type: 1, words: ['今天'] }))
  })
  expect((await recognize(connect, deployment())).text).toBe('今天')
})

it('resolves the access key secret through the credential seam', async () => {
  const ctx = new Context()
  try {
    ctx.provide('credentials', {
      resolve: async (ref: string) => ref === SECRET_REF ? { value: 'seam-secret', source: 'file' } : undefined,
    } as never)
    const { connect, urls } = scripted(completeWith(['好的']))
    await new RtasrRecognizer(ctx, deployment(), connect)
      .transcribe({ audio: canonicalWave(1), language: 'en' }, new AbortController().signal)
    expect(new URL(urls[0]!).searchParams.get('lang')).toBe('en')
    expect(expectedSignature(urls[0]!, 'seam-secret')).toBe(new URL(urls[0]!).searchParams.get('signature'))
  } finally { await ctx.fiber.dispose() }
})

it('falls back to the environment when the seam holds no secret', async () => {
  vi.stubEnv(SECRET_REF, 'env-secret')
  const ctx = new Context()
  try {
    ctx.provide('credentials', { resolve: async () => ({ value: '', source: 'file' }) } as never)
    const { connect, urls } = scripted(completeWith(['好的']))
    await new RtasrRecognizer(ctx, deployment(), connect)
      .transcribe({ audio: canonicalWave(1), language: 'auto' }, new AbortController().signal)
    expect(new URL(urls[0]!).searchParams.get('lang')).toBe('autodialect')
    expect(expectedSignature(urls[0]!, 'env-secret')).toBe(new URL(urls[0]!).searchParams.get('signature'))
  } finally { await ctx.fiber.dispose() }
})

it.each([
  [{ appId: undefined }, 'appId or IFLYTEK_RTASR_APP_ID'],
  [{ accessKeyId: undefined }, 'accessKeyId or IFLYTEK_RTASR_ACCESS_KEY_ID'],
  [{ accessKeySecretRef: UNSET_REF }, UNSET_REF],
])('rejects a recording whose credentials are not configured: %j', async (override, expected) => {
  await expect(recognize(vi.fn(), deployment(override as Partial<Config>))).rejects.toThrow(expected)
})

it.each([
  [{ audio: canonicalWave(1), language: 'ja' }, {}, 'Unsupported RTASR language: ja'],
  [{ audio: new Uint8Array(46), language: 'zh' }, {}, 'canonical 16 kHz mono PCM16 WAV'],
  [{ audio: canonicalWave(100), language: 'zh' }, { maxAudioBytes: 46 }, 'exceeds the provider byte limit'],
  [{ audio: new Uint8Array(new SharedArrayBuffer(46)), language: 'zh' }, {}, 'backed by an ArrayBuffer'],
] as const)('rejects invalid input before connecting: %s', async (input, overrides, expected) => {
  vi.stubEnv(SECRET_REF, 'secret')
  const connect = vi.fn()
  await expect(recognize(connect, deployment(overrides), input)).rejects.toThrow(expected)
  expect(connect).not.toHaveBeenCalled()
})

it('rejects a recording that arrives already cancelled', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(new RtasrRecognizer(new Context(), deployment(), vi.fn())
    .transcribe({ audio: canonicalWave(1), language: 'zh' }, controller.signal)).rejects.toThrow('cancelled')
})

it('stops waiting when the service keeps the connection open past the drain deadline', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect, sockets } = scripted((data, service) => {
    if (typeof data === 'string') return
    service.message(resultFrame({ type: 1, words: ['未完成'] }))
  })
  expect((await recognize(connect, deployment({ drainTimeoutMs: 30 }))).text).toBe('未完成')
  expect(sockets[0]!.closed).toBe(true)
})

it('propagates caller cancellation while the service keeps the connection open', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted(() => {})
  const controller = new AbortController()
  const pending = new RtasrRecognizer(new Context(), deployment({ drainTimeoutMs: 5000 }), connect)
    .transcribe({ audio: canonicalWave(1), language: 'zh' }, controller.signal)
  setTimeout(() => { controller.abort(new Error('caller stopped waiting')) }, 20)
  await expect(pending).rejects.toThrow('caller stopped waiting')
})

it('fails when the service reports an error after the end marker', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted((data, service) => {
    if (typeof data !== 'string') return
    service.message('{"action":"error","code":"10105","desc":"invalid parameter"}')
    service.drop()
  })
  await expect(recognize(connect, deployment(), { audio: canonicalWave(1), language: 'zh' }))
    .rejects.toThrow('RTASR 10105: invalid parameter')
})

it('cancels a recording while its frames are being paced', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted(() => {})
  const controller = new AbortController()
  const pending = new RtasrRecognizer(new Context(), deployment(), connect)
    .transcribe({ audio: canonicalWave(1600), language: 'zh' }, controller.signal)
  setTimeout(() => { controller.abort(new Error('cancelled while pacing')) }, 20)
  await expect(pending).rejects.toThrow('cancelled while pacing')
})

it('fails when the service reports an error frame', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted((data, service) => {
    if (typeof data === 'string') return
    service.message('{"action":"error","code":"10105","desc":"invalid parameter"}')
  })
  await expect(recognize(connect, deployment())).rejects.toThrow('RTASR 10105: invalid parameter')
})

it('fails when the connection fails after opening', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect, sockets } = scripted((data, service) => {
    if (typeof data === 'string') return
    service.fail()
  })
  await expect(recognize(connect, deployment())).rejects.toThrow('RTASR connection failed')
  expect(sockets[0]!.closed).toBe(true)
})

it('fails when the service closes before accepting the connection', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const connect: RtasrConnect = (_url, handlers) => {
    const socket = new FakeSocket(handlers, () => {})
    queueMicrotask(() => { socket.drop() })
    return socket
  }
  await expect(recognize(connect, deployment())).rejects.toThrow('closed the connection before it opened')
})

it('fails when the service never accepts the connection', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const connect: RtasrConnect = (_url, handlers: RtasrHandlers) => new FakeSocket(handlers, () => {})
  await expect(recognize(connect, deployment({ connectTimeoutMs: 20 }))).rejects.toThrow('RTASR_CONNECT_TIMEOUT')
})

it('reports an empty transcript when the service recognized no speech', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted((data, service) => {
    if (typeof data === 'string') service.drop()
  })
  expect((await recognize(connect, deployment())).text).toBe('')
})

it('rejects a response beyond the configured size limit', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted((data, service) => {
    if (typeof data === 'string') return
    service.message('x'.repeat(64))
  })
  await expect(recognize(connect, deployment({ maxResponseBytes: 8 })))
    .rejects.toThrow('RTASR response-too-large')
})

it('rejects an audio frame the service never accepts', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const connect: RtasrConnect = (_url, handlers) => {
    const socket = new FakeSocket(handlers, () => {})
    queueMicrotask(() => {
      socket.accept()
      socket.drop()
    })
    return socket
  }
  await expect(recognize(connect, deployment())).rejects.toThrow('closed before the recording was delivered')
})

it('rejects cancellation raised while the connection is opening', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const controller = new AbortController()
  const connect: RtasrConnect = (_url, handlers) => {
    const socket = new FakeSocket(handlers, () => {})
    controller.abort(new Error('cancelled while opening'))
    return socket
  }
  await expect(new RtasrRecognizer(new Context(), deployment(), connect)
    .transcribe({ audio: canonicalWave(1), language: 'zh' }, controller.signal))
    .rejects.toThrow('cancelled while opening')
})

it('rejects cancellation raised while audio is being delivered', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const controller = new AbortController()
  const connect: RtasrConnect = (_url, handlers) => {
    let frames = 0
    const socket = new FakeSocket(handlers, () => {})
    queueMicrotask(() => { socket.accept() })
    return {
      send: (data) => {
        socket.send(data)
        if (typeof data === 'string' || ++frames < 2) return
        controller.abort(new Error('cancelled while delivering'))
      },
      close: () => { socket.close() },
    }
  }
  await expect(new RtasrRecognizer(new Context(), deployment(), connect)
    .transcribe({ audio: canonicalWave(1600), language: 'zh' }, controller.signal))
    .rejects.toThrow('cancelled while delivering')
})

it('wraps a cancellation whose reason is not an error', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const controller = new AbortController()
  const connect: RtasrConnect = (_url, handlers) => {
    const socket = new FakeSocket(handlers, () => {})
    queueMicrotask(() => {
      socket.accept()
      controller.abort('plain reason')
      socket.drop()
    })
    return socket
  }
  const pending = new RtasrRecognizer(new Context(), deployment(), connect)
    .transcribe({ audio: canonicalWave(1), language: 'zh' }, controller.signal)
  await expect(pending).rejects.toThrow('RTASR recording cancelled')
})

/** Frames of the given byte sizes, all silence. */
async function *liveFrames(sizes: readonly number[]): AsyncIterable<Uint8Array<ArrayBuffer>> {
  for (const size of sizes) yield new Uint8Array(new ArrayBuffer(size))
}

/** One frame followed by a caller that keeps speaking without producing more audio. */
async function *oneThenStall(): AsyncIterable<Uint8Array<ArrayBuffer>> {
  yield new Uint8Array(new ArrayBuffer(1280))
  await Promise.withResolvers<never>().promise
}

/** Every report one live recognition produced, in delivery order. */
async function reports(iterable: AsyncIterable<SpeechSegment>): Promise<SpeechSegment[]> {
  const collected: SpeechSegment[] = []
  for await (const report of iterable) collected.push(report)
  return collected
}

/** Recognize live frames through one scripted connection. */
function recognizeLive(
  connect: RtasrConnect,
  chunks: AsyncIterable<Uint8Array<ArrayBuffer>>,
  config: Config = deployment(),
  language = 'zh',
): Promise<SpeechSegment[]> {
  return reports(new RtasrRecognizer(new Context(), config, connect)
    .transcribeStream({ chunks, language }, new AbortController().signal))
}

it('reports each transcript change while the caller is still speaking', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  let audio = 0
  const { connect, sockets } = scripted((data, service) => {
    if (typeof data === 'string') { service.drop(); return }
    audio += 1
    if (audio === 1) service.message(resultFrame({ type: 1, words: ['今天'] }))
    if (audio === 2) service.message(resultFrame({ type: 1, words: ['今天', '有雨'] }))
  })
  await expect(recognizeLive(connect, liveFrames([1280, 1280]))).resolves.toEqual([
    { final: false, text: '今天' },
    { final: false, text: '今天有雨' },
    { final: true, text: '今天有雨' },
  ])
  expect(sockets[0]?.frames.map(frame => frame.byteLength)).toEqual([1280, 1280])
})

it('re-frames uneven live audio into the service frame size', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect, sockets } = scripted(() => {})
  await recognizeLive(connect, liveFrames([700, 700, 100]))
  expect(sockets[0]?.frames.map(frame => frame.byteLength)).toEqual([1280, 220])
})

it('sends what the caller produced when a live recording fills no frame', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect, sockets } = scripted(() => {})
  await recognizeLive(connect, liveFrames([1000]))
  expect(sockets[0]?.frames.map(frame => frame.byteLength)).toEqual([1000])
})

it('reports a transcript the service repeats only once', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted((data, service) => {
    if (typeof data === 'string') { service.drop(); return }
    service.message(resultFrame({ type: 1, words: ['今天'] }))
  })
  await expect(recognizeLive(connect, liveFrames([1280, 1280]))).resolves.toEqual([
    { final: false, text: '今天' },
    { final: true, text: '今天' },
  ])
})

it('keeps the live transcript when the service never closes', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted((data, service) => {
    if (typeof data === 'string') return
    service.message(resultFrame({ type: 1, words: ['有雨'] }))
  })
  await expect(recognizeLive(connect, liveFrames([1280]))).resolves.toEqual([
    { final: false, text: '有雨' },
    { final: true, text: '有雨' },
  ])
})

it('rejects live audio past the provider byte limit', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted(() => {})
  await expect(recognizeLive(connect, liveFrames([1280]), deployment({ maxAudioBytes: 1024 })))
    .rejects.toThrow('Speech audio exceeds the provider byte limit')
})

it('rejects a live language hint the service does not accept', async () => {
  const connect = vi.fn<RtasrConnect>()
  await expect(recognizeLive(connect, liveFrames([1280]), deployment(), 'fr')).rejects.toThrow('Unsupported RTASR language: fr')
  expect(connect).not.toHaveBeenCalled()
})

it('rejects a live recording that arrives already cancelled', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const controller = new AbortController()
  controller.abort(new Error('cancelled before speaking'))
  const pending = reports(new RtasrRecognizer(new Context(), deployment(), vi.fn())
    .transcribeStream({ chunks: liveFrames([1280]), language: 'zh' }, controller.signal))
  await expect(pending).rejects.toThrow('cancelled before speaking')
})

it('rejects cancellation while the caller is still producing frames', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const controller = new AbortController()
  const sockets: FakeSocket[] = []
  const connect: RtasrConnect = (_url, handlers) => {
    const socket = new FakeSocket(handlers, () => {})
    sockets.push(socket)
    queueMicrotask(() => { socket.accept() })
    return {
      send: (data) => {
        socket.send(data)
        if (typeof data === 'string') return
        controller.abort(new Error('cancelled while speaking'))
      },
      close: () => { socket.close() },
    }
  }
  const pending = reports(new RtasrRecognizer(new Context(), deployment(), connect)
    .transcribeStream({ chunks: oneThenStall(), language: 'zh' }, controller.signal))
  await expect(pending).rejects.toThrow('cancelled while speaking')
  expect(sockets[0]?.closed).toBe(true)
})

it('fails when the service reports an error during live recognition', async () => {
  vi.stubEnv(SECRET_REF, 'secret')
  const { connect } = scripted((data, service) => {
    if (typeof data === 'string') return
    service.message('{"action":"error","code":"10105","desc":"invalid parameter"}')
  })
  await expect(recognizeLive(connect, liveFrames([1280]))).rejects.toThrow('RTASR 10105: invalid parameter')
})

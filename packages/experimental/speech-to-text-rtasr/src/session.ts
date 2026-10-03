/**
 * One RTASR recording session: a signed connection, real-time audio pacing, and
 * the transcript assembled from the service's sentence stream.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { SpeechInput, SpeechSegment, SpeechStreamInput, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { ACCESS_KEY_ID_ENV, APP_ID_ENV, FRAME_BYTES, FRAME_INTERVAL_MS } from './constants.ts'
import type { Config } from './config.ts'
import { isRtasrLanguage, validateInput } from './input.ts'
import { parseRtasrMessage, RtasrTranscript } from './protocol.ts'
import { buildRtasrUrl, type RtasrAuth } from './signer.ts'
import { connectWebSocket, type RtasrConnect, type RtasrSocket } from './socket.ts'

/** The error one cancellation carries; a non-Error reason is kept as its cause. */
function cancellation(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error('RTASR recording cancelled', { cause: reason })
}

/** Reject a phase the caller already cancelled; every phase reports the same error form. */
function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancellation(signal)
}

/** Await one wire outcome while cancellation still applies. */
async function until<T>(signal: AbortSignal, pending: Promise<T>): Promise<T> {
  throwIfCancelled(signal)
  const cancelled = Promise.withResolvers<never>()
  const listener = (): void => { cancelled.reject(cancellation(signal)) }
  signal.addEventListener('abort', listener, { once: true })
  try { return await Promise.race([pending, cancelled.promise]) }
  finally { signal.removeEventListener('abort', listener) }
}

/** Wait out one pacing interval; cancellation rejects instead of waiting. */
function sleep(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(cancellation(signal))
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const abort = (): void => { clearTimeout(timer); reject(cancellation(signal)) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, intervalMs)
  signal.addEventListener('abort', abort, { once: true })
  return promise
}

/**
 * One open connection: its lifecycle, the decoded transcript, and the session
 * id the end message repeats. A transport failure is retained so the phases
 * after it reject with the same cause instead of reporting an empty transcript.
 */
class RtasrSession {
  private readonly connected = Promise.withResolvers<undefined>()
  private readonly settled = Promise.withResolvers<undefined>()
  private readonly transcript = new RtasrTranscript()
  private socket: RtasrSocket | undefined
  private sessionId: string | undefined
  private failure: Error | undefined
  private opened = false
  private terminated = false

  /** @param maxResponseBytes - maximum accepted length of one decoded service message. */
  constructor(private readonly maxResponseBytes: number) {}

  /**
   * Open one connection and wait for the service to accept it.
   * @param connect - connection factory.
   * @param url - signed endpoint.
   * @param signal - fused caller and connect-deadline cancellation.
   */
  async open(connect: RtasrConnect, url: string, signal: AbortSignal): Promise<void> {
    this.socket = connect(url, {
      open: () => { this.opened = true; this.connected.resolve(undefined) },
      message: (text) => { this.accept(text) },
      failed: () => { this.fail(new Error('RTASR connection failed')) },
      closed: () => {
        this.terminate()
        if (!this.opened) this.fail(new Error('RTASR closed the connection before it opened'))
      },
    })
    await Promise.race([until(signal, this.connected.promise), this.settled.promise])
    if (this.failure !== undefined) throw this.failure
  }

  /**
   * Send one audio frame or control message.
   * @param data - binary PCM frame or JSON control message.
   */
  send(data: string | Uint8Array<ArrayBuffer>): void {
    if (this.failure !== undefined) throw this.failure
    if (this.socket === undefined || this.terminated) throw new Error('RTASR session closed before the recording was delivered')
    this.socket.send(data)
  }

  /**
   * Send the end marker and wait for the service to finish.
   * @param signal - fused caller and drain-deadline cancellation. The drain deadline ends the
   * wait without discarding the transcript; a caller abort propagates.
   */
  async finish(signal: AbortSignal): Promise<void> {
    this.send(JSON.stringify({ end: true, ...this.sessionId === undefined ? {} : { sessionId: this.sessionId } }))
    try { await until(signal, this.settled.promise) }
    catch (error) {
      if (timeoutOf(signal, 'RTASR_DRAIN_TIMEOUT') === undefined) throw error
    }
    if (this.failure !== undefined) throw this.failure
  }

  /** @returns the transcript assembled from every segment the service reported. */
  text(): string { return this.transcript.text() }

  /** Close the connection; repeated calls are no-ops. */
  close(): void {
    const socket = this.socket
    this.socket = undefined
    this.terminate()
    socket?.close()
  }

  private accept(text: string): void {
    const message = parseRtasrMessage(text, this.maxResponseBytes)
    if (message.sessionId !== undefined) this.sessionId = message.sessionId
    if (message.segment !== undefined) this.transcript.accept(message.segment)
    if (message.failure !== undefined) this.fail(new Error(`RTASR ${message.failure.code}: ${message.failure.description}`))
  }

  private fail(error: Error): void {
    this.failure ??= error
    this.terminate()
  }

  private terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.settled.resolve(undefined)
  }
}

/** iFlytek RTASR cloud recognizer; one recording owns one signed session. */
export class RtasrRecognizer {
  /**
   * @param ctx - Host context supplying the credential seam and launch environment.
   * @param config - validated deployment configuration.
   * @param connect - connection factory; tests supply their own.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly connect: RtasrConnect = connectWebSocket,
  ) {}

  /**
   * Recognize one complete recording; the connection closes before settlement.
   * @param input - canonical 16 kHz mono PCM16 WAV bytes and a language hint.
   * @param signal - caller cancellation.
   * @returns final transcript and measured audio and inference durations.
   */
  async transcribe(input: SpeechInput, signal: AbortSignal): Promise<Transcript> {
    throwIfCancelled(signal)
    const startedAt = Date.now()
    const { pcm, audioSeconds, language } = validateInput(input.audio, input.language, this.config.maxAudioBytes)
    const auth = await this.auth()
    const session = new RtasrSession(this.config.maxResponseBytes)
    try {
      await this.connectTo(session, buildRtasrUrl(auth, language, randomUUID().replaceAll('-', '')), signal)
      await this.deliver(session, pcm, signal)
      await this.drain(session, signal)
      return { text: session.text(), audioSeconds, inferenceSeconds: (Date.now() - startedAt) / 1000 }
    } finally { session.close() }
  }

  private async connectTo(session: RtasrSession, url: string, signal: AbortSignal): Promise<void> {
    using connecting = deadline(signal, this.config.connectTimeoutMs, 'RTASR_CONNECT_TIMEOUT')
    await session.open(this.connect, url, connecting.signal)
  }

  /**
   * Recognize frames the caller is still producing.
   * @param input - live 16 kHz mono PCM16 frames and the language hint.
   * @param signal - caller cancellation; it also ends consumption of `chunks`.
   * @returns one report per changed transcript while frames arrive, then the settled text.
   */
  async *transcribeStream(input: SpeechStreamInput, signal: AbortSignal): AsyncIterable<SpeechSegment> {
    throwIfCancelled(signal)
    if (!isRtasrLanguage(input.language)) throw new Error(`Unsupported RTASR language: ${input.language}`)
    const auth = await this.auth()
    const session = new RtasrSession(this.config.maxResponseBytes)
    try {
      await this.connectTo(session, buildRtasrUrl(auth, input.language, randomUUID().replaceAll('-', '')), signal)
      yield * this.feed(session, input.chunks, signal)
      await this.drain(session, signal)
      yield { final: true, text: session.text() }
    } finally { session.close() }
  }

  /**
   * Deliver produced frames as the service's 40 ms units and report each transcript change.
   * @param session - open connection.
   * @param chunks - frames the caller produces while speaking; iteration ends when the caller stops.
   * @param signal - caller cancellation.
   * @returns one report per changed transcript, all interim.
   */
  private async *feed(session: RtasrSession, chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<SpeechSegment> {
    const frame = new Uint8Array(new ArrayBuffer(FRAME_BYTES))
    const iterator = chunks[Symbol.asyncIterator]()
    let held = 0
    let delivered = 0
    let reported = ''
    while (true) {
      const next = await until(signal, iterator.next())
      if (next.done === true) break
      const chunk = next.value
      delivered += chunk.byteLength
      if (delivered > this.config.maxAudioBytes) throw new Error('Speech audio exceeds the provider byte limit')
      for (let offset = 0; offset < chunk.byteLength;) {
        const take = Math.min(FRAME_BYTES - held, chunk.byteLength - offset)
        frame.set(chunk.subarray(offset, offset + take), held)
        held += take
        offset += take
        if (held === FRAME_BYTES) { session.send(frame.slice()); held = 0 }
      }
      const text = session.text()
      if (text !== reported) { reported = text; yield { final: false, text } }
    }
    if (held > 0) session.send(frame.slice(0, held))
  }

  private async deliver(session: RtasrSession, pcm: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<void> {
    const frames = Math.ceil(pcm.length / FRAME_BYTES)
    const deliveredAt = Date.now()
    for (let index = 0; index < frames; index++) {
      const due = deliveredAt + index * FRAME_INTERVAL_MS - Date.now()
      if (due > 0) await sleep(due, signal)
      throwIfCancelled(signal)
      session.send(pcm.subarray(index * FRAME_BYTES, Math.min((index + 1) * FRAME_BYTES, pcm.length)))
    }
  }

  private async drain(session: RtasrSession, signal: AbortSignal): Promise<void> {
    using draining = deadline(signal, this.config.drainTimeoutMs, 'RTASR_DRAIN_TIMEOUT')
    await session.finish(draining.signal)
  }

  /** Resolve the account identity and access key secret for the next recording. */
  private async auth(): Promise<RtasrAuth> {
    const environment = launchEnvironmentOf(this.ctx)
    const appId = this.config.appId ?? environment.get(APP_ID_ENV)?.value
    const accessKeyId = this.config.accessKeyId ?? environment.get(ACCESS_KEY_ID_ENV)?.value
    if (appId === undefined || appId === '') throw new Error(`RTASR application id is not configured: set appId or ${APP_ID_ENV}`)
    if (accessKeyId === undefined || accessKeyId === '') {
      throw new Error(`RTASR access key id is not configured: set accessKeyId or ${ACCESS_KEY_ID_ENV}`)
    }
    return { appId, accessKeyId, accessKeySecret: await this.secret(), baseWsUrl: this.config.baseWsUrl }
  }

  private async secret(): Promise<string> {
    const resolved = await this.ctx.get('credentials')?.resolve(credentialRef(this.config.accessKeySecretRef))
    if (resolved !== undefined && resolved.value !== '') return resolved.value
    const ambient = launchEnvironmentOf(this.ctx).get(this.config.accessKeySecretRef)?.value
    if (ambient !== undefined && ambient !== '') return ambient
    throw new Error(`RTASR access key secret is not configured: ${this.config.accessKeySecretRef}`)
  }
}

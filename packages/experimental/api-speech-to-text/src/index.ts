/** Authenticated, cancellation-aware Client access to the speech capability. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService, type RemoteStream } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSegment, SpeechSelectionPatch, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { SpeechAudioChunk, SpeechCatalog, TranscriptionRequest, TranscriptionStreamRequest } from './types.ts'
import { validateWave } from '@deepseek-ai/dsh-experimental-speech-to-text/wave'

/** Bytes of one second of the live carrier's 16 kHz mono PCM16 audio. */
const BYTES_PER_SECOND = 32_000

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental speech Remote controller. */
    speechController: SpeechController
  }
}

/** Limits applied before decoding or calling a provider. */
export interface Config {
  /** Maximum decoded WAV bytes per request. */
  maxAudioBytes: number
  /** Maximum PCM recording duration in seconds. */
  maxDurationSeconds: number
}

/** Speech calls never activate or submit to an Agent. */
export default class SpeechController extends TypertRemoteService {
  static inject = ['speechToText', 'typert']
  static Config: z<Config> = z.object({
    maxAudioBytes: z.natural().min(46).default(4 * 1024 * 1024),
    maxDurationSeconds: z.number().min(1).default(120),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'speechController', { namespace: 'speech' })
  }

  /**
   * Read provider choices without preparing a recognizer.
   * @returns available providers, resolved default, and recording limits.
   */
  @Remote
  catalog(): SpeechCatalog {
    return { ...this.ctx.speechToText.snapshot(), ...this.config }
  }

  /**
   * Follow provider readiness independently of Session and preparation lifetimes.
   * @param signal - Client observation lifetime.
   * @returns initial and subsequent complete readiness snapshots.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<SpeechCatalog> {
    for await (const snapshot of this.ctx.speechToText.follow(signal)) yield { ...snapshot, ...this.config }
  }

  /**
   * Persist the user's recognition preferences.
   * @param patch - changed preference fields.
   * @returns after preferences are saved.
   */
  @Remote
  configure(patch: SpeechSelectionPatch): Promise<void> { return this.ctx.speechToText.configure(patch) }

  /**
   * Start or join one Host-owned preparation task.
   * @param providerId - selected recognizer.
   * @param options - task-local source selection validated by the provider.
   */
  @Remote
  prepare(providerId: SpeechProviderId, options?: SpeechPreparationOptions): void { this.ctx.speechToText.prepare(providerId, options) }

  /**
   * Explicitly cancel resource preparation.
   * @param providerId - selected recognizer.
   * @returns after the preparation task settles.
   */
  @Remote
  cancelPreparation(providerId: SpeechProviderId): Promise<void> { return this.ctx.speechToText.cancelPreparation(providerId) }

  /**
   * Validate and transcribe one recording through the explicit provider selection.
   * @param request - canonical WAV encoded as base64, provider id and language hint.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns final transcript without adding a Session event.
   */
  @Remote
  async transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<Transcript> {
    signal.throwIfAborted()
    const encoded = request.audioBase64
    if (encoded.length > Math.ceil(this.config.maxAudioBytes / 3) * 4) {
      throw new RemoteError('speech/invalid-audio', 'Audio is invalid or exceeds the configured byte limit', { reason: 'encoding-or-size' })
    }
    const audio = Buffer.from(encoded, 'base64')
    try {
      if (audio.toString('base64') !== encoded) throw new Error('Audio must use canonical base64 encoding')
      if (audio.length > this.config.maxAudioBytes) throw new Error('Audio exceeds the configured byte limit')
      validateWave(audio, this.config.maxDurationSeconds)
      const spec = this.ctx.speechToText.resolve({ audio,
        ...request.providerId === undefined ? {} : { providerId: request.providerId },
        ...request.language === undefined ? {} : { language: request.language },
      })
      return await this.ctx.speechToText.transcribe(spec, signal)
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('speech/transcription-failed', reason, { reason })
    }
  }

  /**
   * Recognize live frames the Client is still capturing, reporting text as the recognizer produces it.
   * @param request - provider id and language hint; the audio arrives on this call's uplink.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns the transcript so far after each recognizer report, ending with its settled text.
   */
  @Remote({ mode: 'stream' })
  async *transcribeStream(request: TranscriptionStreamRequest, signal: AbortSignal): RemoteStream<SpeechSegment, SpeechAudioChunk> {
    const invocation = this.ctx.invocation
    if (invocation === undefined) throw new Error('Live transcription ran outside a Remote call')
    signal.throwIfAborted()
    try {
      const spec = this.ctx.speechToText.resolveStream({
        chunks: this.decodeAudio(invocation.uplink<SpeechAudioChunk>(), signal),
        ...request.providerId === undefined ? {} : { providerId: request.providerId },
        ...request.language === undefined ? {} : { language: request.language },
      })
      yield * this.ctx.speechToText.stream(spec, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof RemoteError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('speech/transcription-failed', reason, { reason })
    }
  }

  /**
   * Decode uplink audio while enforcing the configured intake limits.
   * @param items - live audio items the Client sent for this call.
   * @param signal - call cancellation.
   * @returns each decoded batch of frames in arrival order.
   */
  private async *decodeAudio(items: AsyncIterable<SpeechAudioChunk>, signal: AbortSignal): AsyncIterable<Uint8Array<ArrayBuffer>> {
    let delivered = 0
    for await (const item of items) {
      signal.throwIfAborted()
      const audio = Buffer.from(item.audioBase64, 'base64')
      if (audio.toString('base64') !== item.audioBase64) throw this.refused('Live audio must use canonical base64 encoding', 'encoding')
      if (audio.length === 0 || audio.length % 2 !== 0) throw this.refused('Live audio must carry whole PCM16 samples', 'alignment')
      delivered += audio.length
      if (delivered > this.config.maxAudioBytes) throw this.refused('Live audio exceeds the configured byte limit', 'encoding-or-size')
      if (delivered > this.config.maxDurationSeconds * BYTES_PER_SECOND) {
        throw this.refused('Live transcription exceeded the configured duration', 'duration')
      }
      yield audio
    }
  }

  /**
   * @param message - Client-facing explanation.
   * @param reason - machine-readable cause carried in the error details.
   * @returns the refusal every rejected live audio batch reports.
   */
  private refused(message: string, reason: string): RemoteError {
    return new RemoteError('speech/invalid-audio', message, { reason })
  }
}

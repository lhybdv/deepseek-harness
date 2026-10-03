/** Authenticated, cancellation-aware Client access to speech synthesis. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-text-to-speech'
import type { SpeechSynthesisRequest } from '@deepseek-ai/dsh-text-to-speech/types'
import type { SynthesisRequest, SynthesisResult } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { /** Experimental synthesis Remote controller. */ speechSynthesisController: SpeechSynthesisController } }
/** Synthesis intake limit. */
export interface Config { maxTextLength: number }
/** Authenticated synthesis Remote controller. */
export default class SpeechSynthesisController extends TypertRemoteService {
  static inject = ['speechSynthesis', 'typert']
  static Config: z<Config> = z.object({ maxTextLength: z.natural().min(1).default(4000) })
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'speechSynthesisController', { namespace: 'speechSynthesis' }) }
  /** Synthesize caller text without adding a Session event. @param request - text to synthesize. @param signal - caller/disposal cancellation. @returns MIME type and base64 audio. */
  @Remote
  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    signal.throwIfAborted()
    if (request.text.trim() === '' || request.text.length > this.config.maxTextLength) {
      throw new RemoteError('speech-synthesis/invalid-text', 'Text is empty or exceeds the configured limit', { reason: 'text-limit' })
    }
    try {
      const audio = await this.ctx.speechSynthesis.synthesize({ text: request.text } satisfies SpeechSynthesisRequest, signal)
      return { audioBase64: Buffer.from(audio).toString('base64'), mimeType: 'audio/mpeg' }
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('speech-synthesis/failed', reason, { reason })
    }
  }
}

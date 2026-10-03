/** iFlytek RTASR cloud recognizer; activation performs no network or credential work. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { Config } from './config.ts'
import { languages } from './input.ts'
import { RtasrRecognizer } from './session.ts'

export { Config } from './config.ts'
export const name = 'experimental-speech-to-text-rtasr'
export const inject = ['speechToText']

/**
 * Register the cloud recognizer. Credentials are resolved when a recording
 * starts, so a deployment may supply them after the Host has booted.
 * @param ctx - Host context owning the speech registry.
 * @param config - validated deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const recognizer = new RtasrRecognizer(ctx, config)
  ctx.effect(() => ctx.speechToText.register({
    info: { id: config.providerId as SpeechProviderId, name: 'iFlytek RTASR', location: 'cloud', languages, streaming: true },
    transcribe: async (input, signal) => await recognizer.transcribe(input, signal),
    transcribeStream: (input, signal) => recognizer.transcribeStream(input, signal),
  }))
}

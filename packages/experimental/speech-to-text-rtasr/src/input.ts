/** Accepted language hints and audio validation for the RTASR recognizer. */
import { validateWave } from '@deepseek-ai/dsh-experimental-speech-to-text/wave'
import { WAV_HEADER_BYTES } from './constants.ts'

/** Language hints this provider advertises, matching the service's `lang` parameter. */
export const languages = ['auto', 'zh', 'en'] as const

/** One advertised language hint. */
export type RtasrLanguage = (typeof languages)[number]

/**
 * Service `lang` parameter per accepted hint. `autodialect` recognizes mixed
 * speech and dialect; `cn` and `en` pin one language.
 */
export const languageParameters: Readonly<Record<RtasrLanguage, string>> = { auto: 'autodialect', zh: 'cn', en: 'en' }

/**
 * Whether one hint is accepted by this provider.
 * @param value - candidate language hint.
 * @returns whether a service parameter exists for it.
 */
export function isRtasrLanguage(value: string): value is RtasrLanguage {
  return languages.some(language => language === value)
}

/** One validated recording: the service-bound PCM samples and their measured duration. */
export interface ValidatedRecording {
  /** PCM samples without the canonical WAV header, borrowed from the request and backed by an ArrayBuffer. */
  readonly pcm: Uint8Array<ArrayBuffer>
  /** Recording duration in seconds, measured from the sample count. */
  readonly audioSeconds: number
  /** Validated hint, narrowed for the service parameter lookup. */
  readonly language: RtasrLanguage
}

/**
 * Validate one recording before any connection is opened.
 * @param audio - untrusted WAV request bytes.
 * @param language - requested language hint.
 * @param maxAudioBytes - configured provider byte limit.
 * @returns the PCM samples, duration, and accepted hint; invalid input throws.
 */
export function validateInput(audio: Uint8Array, language: string, maxAudioBytes: number): ValidatedRecording {
  if (!isRtasrLanguage(language)) throw new Error(`Unsupported RTASR language: ${language}`)
  if (audio.byteLength > maxAudioBytes) throw new Error('Speech audio exceeds the provider byte limit')
  const buffer = audio.buffer
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Speech audio must be backed by an ArrayBuffer')
  const audioSeconds = validateWave(audio, maxAudioBytes / 32000)
  return {
    pcm: new Uint8Array(buffer, audio.byteOffset + WAV_HEADER_BYTES, audio.byteLength - WAV_HEADER_BYTES),
    audioSeconds,
    language,
  }
}

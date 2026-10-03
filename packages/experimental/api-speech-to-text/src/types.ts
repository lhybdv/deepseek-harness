/** JSON-safe inputs and results of the experimental speech Remote namespace. */
import type { SpeechProviderId, SpeechSnapshot } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Audio encoding or intake limits prevented transcription. */
    'speech/invalid-audio': { readonly reason: string }
    /** The selected provider rejected transcription. */
    'speech/transcription-failed': { readonly reason: string }
  }
}

/** Complete recording submitted for transcription, separate from Session admission. */
export interface TranscriptionRequest {
  readonly audioBase64: string
  readonly providerId?: SpeechProviderId
  readonly language?: string
}

/** Live recognition request; the audio arrives on the same logical stream's uplink. */
export interface TranscriptionStreamRequest {
  readonly providerId?: SpeechProviderId
  readonly language?: string
}

/** One uplink item: 16 kHz mono PCM16 frames, base64-encoded for the JSON carrier. */
export interface SpeechAudioChunk {
  readonly audioBase64: string
}

/** Current provider choices and audio intake limits. */
export interface SpeechCatalog extends SpeechSnapshot {
  readonly maxAudioBytes: number
  readonly maxDurationSeconds: number
}

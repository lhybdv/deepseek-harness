/** JSON-safe inputs and results of the experimental speech synthesis Remote. */
import type {} from '@deepseek-ai/dsh-typert-protocol'
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Caller text is empty or too long. */ 'speech-synthesis/invalid-text': { readonly reason: string }
    /** The selected provider could not synthesize the text. */ 'speech-synthesis/failed': { readonly reason: string }
  }
}
/** Text requested for speech synthesis. */
export interface SynthesisRequest { readonly text: string }
/** Encoded audio response safe for JSON transport. */
export interface SynthesisResult { readonly audioBase64: string; readonly mimeType: 'audio/mpeg' }

/** Provider-neutral speech synthesis inputs and registration metadata. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Configured identity of one synthesis provider. */
export type SpeechSynthesisProviderId = Branded<'SpeechSynthesisProviderId'>

/** Public provider facts; credentials are excluded. */
export interface SpeechSynthesisProviderInfo { readonly id: SpeechSynthesisProviderId; readonly name: string; readonly location: 'cloud' | 'host-local' }

/** One request to synthesize text. */
export interface SpeechSynthesisRequest { readonly text: string }

/** One replaceable synthesis provider. */
export interface SpeechSynthesisProvider {
  readonly info: SpeechSynthesisProviderInfo
  /** @param request - text and validated voice options. @param signal - caller and provider lifetime cancellation. @returns encoded audio bytes. */
  synthesize(request: SpeechSynthesisRequest, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>
}

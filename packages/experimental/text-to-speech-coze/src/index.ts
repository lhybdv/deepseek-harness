/** Coze cloud speech synthesis; credentials are resolved on each request on the Host. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-text-to-speech'
import type { SpeechSynthesisProviderId } from '@deepseek-ai/dsh-text-to-speech/types'
import z from '@deepseek-ai/schemastery'

/** Validated deployment options for Coze synthesis. */
export interface Config { providerId: string; credentialRef: string; baseUrl: string; voiceId: string; emotion: string }
/** Runtime configuration schema. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('coze'), credentialRef: z.string().min(1).default('coze-api-token'),
  baseUrl: z.string().pattern(/^https:\/\/[^/\s?#@]+(?:\/[^\s?#]*)?$/).default('https://api.coze.cn/v1/audio/speech'),
  voiceId: z.string().min(1).default('7426720361732964361'), emotion: z.string().min(1).default('normal'),
})
export const name = 'experimental-text-to-speech-coze'
export const inject = ['speechSynthesis', 'credentials']
/** Register Coze synthesis provider. @param ctx - Host context. @param config - validated deployment settings. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.speechSynthesis.register({
    info: { id: config.providerId as SpeechSynthesisProviderId, name: 'Coze', location: 'cloud' },
    synthesize: async ({ text }, signal) => {
      signal.throwIfAborted()
      const credential = await ctx.get('credentials')?.resolve(credentialRef(config.credentialRef))
      const token = credential?.value
      if (!token) throw new Error(`Coze credential is unavailable: ${config.credentialRef}`)
      const response = await fetch(config.baseUrl, { method: 'POST', signal,
        headers: { Authorization: `Bearer ${token}`, Accept: 'audio/mpeg', 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: config.voiceId, input: text, emotion: config.emotion }),
      })
      if (!response.ok) throw new Error(`Coze speech request failed with HTTP ${response.status}`)
      const audio = await response.arrayBuffer()
      if (audio.byteLength === 0) throw new Error('Coze returned empty audio')
      return new Uint8Array(audio)
    },
  }))
}

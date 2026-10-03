/** Deployment configuration for the iFlytek RTASR cloud recognizer. */
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { ACCESS_KEY_SECRET_REF, DEFAULT_BASE_WS_URL } from './constants.ts'

/** iFlytek account, endpoint, and session limits. */
export interface Config {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** iFlytek application id; omission reads {@link APP_ID_ENV}. */
  appId?: string | undefined
  /** iFlytek access key id; omission reads {@link ACCESS_KEY_ID_ENV}. */
  accessKeyId?: string | undefined
  /**
   * Credential reference naming the access key secret. The value is resolved
   * once per recording through `ctx.credentials`, falling back to the ambient
   * environment, so a stored secret needs no plugin restart and never enters
   * this configuration.
   */
  accessKeySecretRef: string
  /** RTASR WebSocket endpoint. */
  baseWsUrl: string
  /** Maximum decoded WAV bytes accepted before connecting. */
  maxAudioBytes: number
  /** Maximum length of one decoded service message. */
  maxResponseBytes: number
  /** Deadline for establishing a transcription connection. */
  connectTimeoutMs: number
  /** Deadline for the final result after the last audio frame is delivered. */
  drainTimeoutMs: number
}

/** Validate deployment-varying account and endpoint choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('iflytek-rtasr'),
  appId: z.union([z.string().min(1), z.const(undefined)]),
  accessKeyId: z.union([z.string().min(1), z.const(undefined)]),
  accessKeySecretRef: z.string().min(1).default(ACCESS_KEY_SECRET_REF),
  baseWsUrl: z.string().pattern(/^wss?:\/\/[^/\s?#@]+\/?[^\s?#]*$/).default(DEFAULT_BASE_WS_URL),
  maxAudioBytes: z.natural().min(46).default(4 * 1024 * 1024),
  maxResponseBytes: z.natural().min(1).default(1024 * 1024),
  connectTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(10_000),
  drainTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
})

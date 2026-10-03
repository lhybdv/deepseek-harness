/**
 * RTASR request signing. The service authenticates each session from a sorted,
 * percent-encoded parameter list signed with HMAC-SHA1 under the account's
 * access key secret, plus a Beijing-time `utc` that bounds replay.
 */
import { createHmac } from 'node:crypto'
import { languageParameters, type RtasrLanguage } from './input.ts'

/** Parameters every RTASR session declares; the service protocol fixes their values. */
const AUDIO_PARAMETERS: Readonly<Record<string, string>> = { audio_encode: 'pcm_s16le', samplerate: '16000' }

/** iFlytek account identity and the endpoint one session connects to. */
export interface RtasrAuth {
  /** iFlytek application id. */
  readonly appId: string
  /** iFlytek access key id. */
  readonly accessKeyId: string
  /** iFlytek access key secret; never logged or returned. */
  readonly accessKeySecret: string
  /** RTASR WebSocket endpoint. */
  readonly baseWsUrl: string
}

/** Zero-pad one timestamp field to two digits. */
function pad(value: number): string { return String(value).padStart(2, '0') }

/**
 * Format one instant as the signed `utc` parameter.
 * @param now - instant to format.
 * @returns Beijing wall-clock time as `YYYY-MM-DDThh:mm:ss+0800`.
 */
export function beijingTimestamp(now: Date): string {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())}`
    + `T${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}:${pad(beijing.getUTCSeconds())}+0800`
}

/**
 * Sign one session's parameters.
 * @param secret - iFlytek access key secret.
 * @param parameters - every non-empty session parameter except the signature.
 * @returns base64 HMAC-SHA1 over the parameters sorted by name and percent-encoded.
 */
export function signParameters(secret: string, parameters: Readonly<Record<string, string>>): string {
  const base = Object.entries(parameters)
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => left < right ? -1 : 1)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&')
  return createHmac('sha1', secret).update(base).digest('base64')
}

/**
 * Build the authenticated endpoint for one recording session.
 * @param auth - account identity and endpoint.
 * @param language - advertised language hint.
 * @param sessionId - 32-character session identifier without separators.
 * @param now - clock used for the signed timestamp.
 * @returns endpoint carrying every session parameter and its signature.
 */
export function buildRtasrUrl(auth: RtasrAuth, language: RtasrLanguage, sessionId: string, now = new Date()): string {
  const parameters: Record<string, string> = {
    ...AUDIO_PARAMETERS,
    accessKeyId: auth.accessKeyId,
    appId: auth.appId,
    lang: languageParameters[language],
    utc: beijingTimestamp(now),
    uuid: sessionId,
  }
  const query = new URLSearchParams({ ...parameters, signature: signParameters(auth.accessKeySecret, parameters) })
  return `${auth.baseWsUrl}?${query.toString()}`
}

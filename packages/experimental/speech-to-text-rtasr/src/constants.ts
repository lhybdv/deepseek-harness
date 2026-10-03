/**
 * Protocol constants of the iFlytek RTASR session. These are part of the
 * external service specification, not deployment choices: every deployment
 * streams the same frame size at the same cadence to the same documented
 * endpoint family.
 */

/** Documented RTASR real-time transcription endpoint. */
export const DEFAULT_BASE_WS_URL = 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1'

/** Credential reference the provider resolves when its section names none. */
export const ACCESS_KEY_SECRET_REF = 'IFLYTEK_RTASR_ACCESS_KEY_SECRET'

/** Environment variable supplying the iFlytek application id. */
export const APP_ID_ENV = 'IFLYTEK_RTASR_APP_ID'

/** Environment variable supplying the iFlytek access key id. */
export const ACCESS_KEY_ID_ENV = 'IFLYTEK_RTASR_ACCESS_KEY_ID'

/** Audio frame size the service consumes: 16 kHz, 16-bit, one channel, 40 ms. */
export const FRAME_BYTES = 1280

/** Pacing interval of one audio frame in milliseconds, so audio arrives in real time. */
export const FRAME_INTERVAL_MS = 40

/** Canonical WAV header length preceding the PCM samples. */
export const WAV_HEADER_BYTES = 44

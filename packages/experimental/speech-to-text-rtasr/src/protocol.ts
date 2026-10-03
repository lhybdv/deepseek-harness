/**
 * RTASR wire decoding. One service message reports at most three independent
 * facts — the session identity the end message must repeat, transcript text,
 * and a service failure — so they are read together rather than as exclusive
 * variants.
 *
 * The service's envelope carries advisory fields (timing offsets, `action`,
 * `sid`) beside the ones used here and types some of them inconsistently, so
 * the envelope is read field by field and the result node is parsed with the
 * schema of the documented shape. A frame that does not match it carries no
 * transcript text and leaves the session running.
 */
import { z } from 'zod'

/** One transcript segment: the sentence text and whether the service considers it final. */
export interface RtasrSegment {
  /** Whether the service reported this sentence as final; an interim sentence may still change. */
  readonly final: boolean
  /** Sentence text as reported by the service. */
  readonly text: string
}

/** Service-reported rejection carrying the service's own code and description. */
export interface RtasrFailure {
  /** Service error code, non-zero. */
  readonly code: string
  /** Service description, or a provider message when the service sent none. */
  readonly description: string
}

/** Facts decoded from one service message. */
export interface RtasrMessage {
  /** Session id assigned by the service; the end message repeats it. */
  readonly sessionId?: string
  /** Transcript text carried by this message, when it carries any. */
  readonly segment?: RtasrSegment
  /** Service rejection; the session stops and reports it. */
  readonly failure?: RtasrFailure
}

/**
 * The documented result node. Result types are `0` (final sentence) and `1`
 * (interim sentence) by the service's specification, which the live service
 * emits as JSON strings; a numeric type from a service variant means the same.
 */
const ResultNode = z.object({
  type: z.union([z.string(), z.number()]),
  rt: z.array(z.object({
    ws: z.array(z.object({
      cw: z.array(z.object({ w: z.string() })),
    })),
  })),
})

/**
 * Read the sentence of one result node.
 * @param st - the `st` node of one message.
 * @returns the sentence and whether the service considers it final, or undefined when the
 * frame does not match the documented shape.
 */
function readSentence(st: unknown): RtasrSegment | undefined {
  const parsed = ResultNode.safeParse(st)
  if (!parsed.success) return undefined
  const text = parsed.data.rt.flatMap(sentence => sentence.ws.flatMap(word => word.cw.map(character => character.w))).join('')
  return text === '' ? undefined : { final: String(parsed.data.type) === '0', text }
}

/** Read the service's result code as text; an absent code means the message succeeded. */
function readCode(payload: object): string | undefined {
  if (!('code' in payload)) return undefined
  const code: unknown = payload.code
  if (typeof code === 'string' || typeof code === 'number') return String(code)
  return 'invalid-code'
}

/** Read the transcript segment of one message, or undefined when it carries none. */
function readSegment(payload: object): RtasrSegment | undefined {
  const data = 'data' in payload ? payload.data : undefined
  const cn = typeof data === 'object' && data !== null && 'cn' in data ? data.cn : undefined
  const st = typeof cn === 'object' && cn !== null && 'st' in cn ? cn.st : undefined
  return readSentence(st)
}

/** Read the session id from the places the service has been observed to report it. */
function readSessionId(payload: object): string | undefined {
  const direct = 'sessionId' in payload ? payload.sessionId : 'sid' in payload ? payload.sid : undefined
  if (typeof direct === 'string' && direct !== '') return direct
  const data = 'data' in payload ? payload.data : undefined
  if (typeof data === 'object' && data !== null && 'sessionId' in data && typeof data.sessionId === 'string' && data.sessionId !== '') {
    return data.sessionId
  }
  return undefined
}

/**
 * Decode one service message.
 * @param raw - text frame received from the service.
 * @param maxBytes - maximum accepted frame length.
 * @returns every fact the message carried; an unreadable frame carries none.
 */
export function parseRtasrMessage(raw: string, maxBytes: number): RtasrMessage {
  if (raw.length > maxBytes) {
    return { failure: { code: 'response-too-large', description: 'RTASR response exceeded the configured size limit' } }
  }
  let decoded: unknown
  try { decoded = JSON.parse(raw) }
  catch { return {} }
  if (typeof decoded !== 'object' || decoded === null) return {}
  const payload: object = decoded
  const code = readCode(payload)
  if (code !== undefined && code !== '0') {
    const description = 'desc' in payload ? payload.desc : undefined
    return { failure: { code,
      description: typeof description === 'string' && description !== '' ? description : 'RTASR reported an error' } }
  }
  const sessionId = readSessionId(payload)
  const segment = readSegment(payload)
  return {
    ...sessionId === undefined ? {} : { sessionId },
    ...segment === undefined ? {} : { segment },
  }
}

/**
 * Assemble the sentence stream into one transcript. A final segment extends the
 * text; an interim segment replaces the sentence still being recognized.
 */
export class RtasrTranscript {
  private readonly finals: string[] = []
  private interim = ''

  /**
   * Apply one decoded segment.
   * @param segment - sentence text and whether the service considers it final.
   */
  accept(segment: RtasrSegment): void {
    if (segment.final) {
      this.finals.push(segment.text)
      this.interim = ''
      return
    }
    this.interim = segment.text
  }

  /**
   * Read the transcript so far.
   * @returns every final segment followed by the sentence still being recognized, which a
   * service that stopped without finalizing it never repeats.
   */
  text(): string { return this.finals.join('') + this.interim }
}

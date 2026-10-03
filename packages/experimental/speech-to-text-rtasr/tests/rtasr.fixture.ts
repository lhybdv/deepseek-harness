/** Fixtures shared by the RTASR provider tests: recordings, service frames, and a scripted connection. */
import type { RtasrHandlers, RtasrSocket } from '../src/socket.ts'

/**
 * Build one canonical 16 kHz mono PCM16 WAV recording.
 * @param samples - sample count; one sample is the shortest valid recording.
 * @returns complete WAV bytes with a silent payload.
 */
export function canonicalWave(samples: number): Uint8Array {
  const payload = Buffer.alloc(samples * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + payload.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(payload.length, 40)
  return new Uint8Array(Buffer.concat([header, payload]))
}

/**
 * One result frame as the service sends it: sentence timing, the final/interim
 * discriminant typed as a JSON string, and one word per entry.
 */
export function resultFrame(options: {
  type: 0 | 1
  words: readonly string[]
  sessionId?: string
}): string {
  return JSON.stringify({
    action: 'result',
    code: '0',
    desc: 'success',
    ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
    data: {
      cn: {
        st: {
          bg: '0',
          ed: '480',
          type: String(options.type),
          rt: [{ ws: options.words.map(word => ({ bg: '0', ed: '480', cw: [{ w: word }] })) }],
        },
      },
    },
  })
}

/** A scripted connection recording every frame and control message the recognizer sends. */
export class FakeSocket implements RtasrSocket {
  /** Binary frames in send order. */
  readonly frames: Uint8Array<ArrayBuffer>[] = []
  /** Control messages in send order, decoded. */
  readonly controls: unknown[] = []
  /** Whether the recognizer closed this connection. */
  closed = false

  /**
   * @param handlers - lifecycle callbacks the recognizer registered.
   * @param onSend - how the scripted service reacts to each frame or control message.
   */
  constructor(
    private readonly handlers: RtasrHandlers,
    private readonly onSend: (data: string | Uint8Array<ArrayBuffer>, service: FakeSocket) => void,
  ) {}

  send(data: string | Uint8Array<ArrayBuffer>): void {
    if (typeof data === 'string') this.controls.push(JSON.parse(data))
    else this.frames.push(data)
    this.onSend(data, this)
  }

  close(): void { this.closed = true }

  /** Report the service accepting the connection. */
  accept(): void { this.handlers.open() }

  /** Report one service frame. */
  message(text: string): void { this.handlers.message(text) }

  /** Report a transport failure. */
  fail(): void { this.handlers.failed() }

  /** Report the service closing the connection. */
  drop(): void { this.handlers.closed() }
}

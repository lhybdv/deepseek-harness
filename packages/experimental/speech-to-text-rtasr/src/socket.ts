/**
 * The connection port the RTASR session drives, plus its default WebSocket
 * implementation. Tests supply their own {@link RtasrConnect} to run the
 * session without a service.
 */

/** Lifecycle callbacks one RTASR connection reports; each fires at most once except messages. */
export interface RtasrHandlers {
  /** The service accepted the connection. */
  readonly open: () => void
  /** One text frame arrived. */
  readonly message: (text: string) => void
  /** The connection failed; a close callback follows. */
  readonly failed: () => void
  /** The connection closed, whether or not it had opened. */
  readonly closed: () => void
}

/** One open RTASR connection. */
export interface RtasrSocket {
  /** Send one binary audio frame or one JSON control message. */
  send(data: string | Uint8Array<ArrayBuffer>): void
  /** Close the connection; a socket that already closed ignores this. */
  close(): void
}

/** Open one RTASR connection and report its lifecycle to the given handlers. */
export type RtasrConnect = (url: string, handlers: RtasrHandlers) => RtasrSocket

/** Render one received frame as text; only text frames carry RTASR messages. */
function decodeFrame(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  return ''
}

/**
 * Open one connection with the runtime's WebSocket client.
 * @param url - signed endpoint.
 * @param handlers - lifecycle callbacks.
 * @returns the connection the session sends frames through.
 */
export const connectWebSocket: RtasrConnect = (url, handlers) => {
  const socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  socket.addEventListener('open', () => { handlers.open() })
  socket.addEventListener('message', (event) => { handlers.message(decodeFrame(event.data)) })
  socket.addEventListener('error', () => { handlers.failed() })
  socket.addEventListener('close', () => { handlers.closed() })
  return {
    send: (data) => { socket.send(data) },
    close: () => { socket.close() },
  }
}

/** The default connection port delegates to the runtime WebSocket client. */
import { afterEach, expect, it, vi } from 'vitest'
import { connectWebSocket } from '../src/socket.ts'

/** Stand-in for the runtime WebSocket client, capturing the listeners a connection registers. */
class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = []
  binaryType = ''
  readonly sent: unknown[] = []
  closed = false
  private readonly listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {}

  constructor(readonly url: string) { FakeWebSocket.instances.push(this) }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners[type] = [...this.listeners[type] ?? [], listener]
  }

  send(data: unknown): void { this.sent.push(data) }

  close(): void { this.closed = true }

  /** Deliver one event to every listener the connection registered. */
  emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners[type] ?? []) listener(event)
  }
}

afterEach(() => { FakeWebSocket.instances.length = 0; vi.unstubAllGlobals() })

it('forwards connection lifecycle and decodes text frames', () => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const opened: string[] = []
  const messages: string[] = []
  const failures: string[] = []
  const closes: string[] = []
  const socket = connectWebSocket('wss://service.example/session', {
    open: () => { opened.push('open') },
    message: (text) => { messages.push(text) },
    failed: () => { failures.push('failed') },
    closed: () => { closes.push('closed') },
  })
  const client = FakeWebSocket.instances[0]!
  expect(client.url).toBe('wss://service.example/session')
  expect(client.binaryType).toBe('arraybuffer')

  client.emit('open')
  client.emit('message', { data: '{"code":"0"}' })
  client.emit('message', { data: new TextEncoder().encode('{"code":"0"}').buffer })
  client.emit('message', { data: new TextEncoder().encode('{"code":"0"}') })
  client.emit('message', { data: 7 })
  client.emit('error')
  client.emit('close')

  expect({ opened, messages, failures, closes }).toEqual({
    opened: ['open'],
    messages: ['{"code":"0"}', '{"code":"0"}', '{"code":"0"}', ''],
    failures: ['failed'],
    closes: ['closed'],
  })

  socket.send(new Uint8Array([1, 2]))
  socket.send('{"end":true}')
  socket.close()
  expect(client.sent).toEqual([new Uint8Array([1, 2]), '{"end":true}'])
  expect(client.closed).toBe(true)
})

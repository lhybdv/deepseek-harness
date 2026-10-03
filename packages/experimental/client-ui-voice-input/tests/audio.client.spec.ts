/** Browser recording bytes conform to the Host's fixed PCM format. */
import { afterEach, expect, it, vi } from 'vitest'
import { audioBase64, encodeWave, Recording, RecordingError } from '../src/client/audio.ts'
import { captureFixture } from './audio-fixture.client.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('encodes bounded PCM samples and base64 across chunk boundaries', () => {
  const bytes = encodeWave(new Float32Array([-2, -0.5, 0, 0.5, 2]))
  const view = new DataView(bytes.buffer)
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
  expect(view.getUint32(24, true)).toBe(16000)
  expect(view.getUint32(40, true)).toBe(10)
  expect([0, 1, 2, 3, 4].map(i => view.getInt16(44 + i * 2, true))).toEqual([-32768, -16384, 0, 16384, 32767])
  const large = encodeWave(new Float32Array(17000))
  expect(Buffer.from(audioBase64(large), 'base64')).toEqual(Buffer.from(large))
})

it('reports unavailable recording and denied permission', async () => {
  vi.stubGlobal('navigator', {})
  const recording = new Recording(() => {})
  await expect(recording.start()).rejects.toMatchObject({ kind: 'unavailable' })
  vi.stubGlobal('MediaRecorder', function RecorderStub() {})
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError') } } })
  await expect(recording.start()).rejects.toMatchObject({ kind: 'permission' })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => { throw new Error('device lost') } } })
  await expect(recording.start()).rejects.toThrow('device lost')
  expect(new RecordingError('empty').message).toBe('empty')
})

it('releases a microphone granted after cancellation', async () => {
  const permission = Promise.withResolvers<{ getTracks: () => { stop: () => void }[] }>()
  const stop = vi.fn(), dispose = vi.fn()
  vi.stubGlobal('MediaRecorder', function RecorderStub() {})
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => permission.promise } })
  const recording = new Recording(dispose)
  const acquiring = recording.start()
  await recording.dispose()
  permission.resolve({ getTracks: () => [{ stop }] })
  await expect(acquiring).rejects.toMatchObject({ kind: 'cancelled' })
  expect(stop).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
})


it('flushes final recording bytes, bounds timer overshoot and closes audio resources', async () => {
  const b = captureFixture()
  expect(b.recording.amplitude()).toBe(0)
  await b.recording.start()
  expect(b.recording.amplitude()).toBe(0.25)
  const result = await b.recording.stop(1)
  expect(new TextDecoder().decode(b.decoding.mock.calls[0]![0])).toBe('final audio')
  expect(b.offline).toHaveBeenCalledWith(1, 16000, 16000)
  expect(result).toEqual(encodeWave(new Float32Array([0.5, -0.5])))
  expect(b.trackStop).toHaveBeenCalled()
  expect(b.close).toHaveBeenCalledOnce()
  await b.recording.dispose()
  expect(b.close).toHaveBeenCalledOnce()
})

it.each([{ empty: true }, { recorderError: true }, { constructError: true }])('releases failed capture resources: %j', async (options) => {
  const b = captureFixture(options)
  if (options.constructError) await expect(b.recording.start()).rejects.toThrow('recorder unavailable')
  else { await b.recording.start(); await expect(b.recording.stop(120)).rejects.toMatchObject({ kind: 'empty' }) }
  expect(b.trackStop).toHaveBeenCalled()
  expect(b.close).toHaveBeenCalledOnce()
})

it('discards decoding results that finish after cancellation', async () => {
  const b = captureFixture(), decoded = Promise.withResolvers<{ duration: number }>()
  b.decoding.mockReturnValueOnce(decoded.promise)
  await b.recording.start()
  const stopping = b.recording.stop(120), rejected = expect(stopping).rejects.toMatchObject({ kind: 'cancelled' })
  await vi.waitFor(() => { expect(b.decoding).toHaveBeenCalledOnce() })
  await b.recording.dispose()
  decoded.resolve({ duration: 2 })
  await rejected
  expect(b.rendering).not.toHaveBeenCalled()
  await expect(b.recording.stop(120)).rejects.toMatchObject({ kind: 'empty' })
})

it('releases active capture on a spontaneous recorder error even when AudioContext.close rejects', async () => {
  const b = captureFixture()
  await b.recording.start()
  b.close.mockRejectedValueOnce(new Error('audio device disconnected'))
  b.failRecorder()
  await vi.waitFor(() => { expect(b.disposed).toHaveBeenCalledOnce() })
  expect(b.trackStop).toHaveBeenCalled()
  await expect(b.recording.dispose()).rejects.toThrow('audio device disconnected')
})

it.each([false, true])('shares pending AudioContext closure across repeated release (failure=%s)', async (failed) => {
  const b = captureFixture(), closing = Promise.withResolvers<undefined>()
  b.close.mockReturnValueOnce(closing.promise)
  await b.recording.start()
  const first = b.recording.dispose(), second = b.recording.dispose()
  const results = Promise.allSettled([first, second])
  try {
    expect(first).toBe(second)
    expect(b.trackStop).toHaveBeenCalledOnce()
    expect(b.close).toHaveBeenCalledOnce()
    expect(b.disposed).not.toHaveBeenCalled()
  } finally {
    if (failed) closing.reject(new Error('audio close failed'))
    else closing.resolve(undefined)
    await results
  }
  expect(b.disposed).toHaveBeenCalledOnce()
  expect(b.recording.dispose()).toBe(first)
  expect((await results).map(result => result.status)).toEqual(failed ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled'])
})

it('reports a device interruption once while resource closure is still pending', async () => {
  const b = captureFixture(), closing = Promise.withResolvers<undefined>(), failure = vi.fn()
  b.close.mockReturnValueOnce(closing.promise)
  await b.recording.start(failure)
  try {
    b.failRecorder(); b.failRecorder()
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'interrupted' }))
    expect(b.trackStop).toHaveBeenCalledOnce()
    expect(b.disposed).not.toHaveBeenCalled()
  } finally { closing.resolve(undefined); await b.recording.dispose() }
  expect(b.disposed).toHaveBeenCalledOnce()
})

it('contains a failing interruption callback and still releases the microphone', async () => {
  const b = captureFixture(), error = new Error('callback failed'), report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await b.recording.start(() => { throw error })
    b.failRecorder()
    await b.recording.dispose()
    expect(b.trackStop).toHaveBeenCalledOnce()
    expect(b.disposed).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith('Speech recording error handler failed', error)
  } finally { report.mockRestore(); await b.recording.dispose() }
})

it('streams 200 ms of 16 kHz mono PCM16 while live capture runs', async () => {
  const b = captureFixture()
  const frames: Uint8Array[] = []
  await b.recording.startLive((batch) => { frames.push(batch) })
  expect(b.addModule).toHaveBeenCalledWith('blob:capture')
  expect(b.createObjectURL).toHaveBeenCalledTimes(1)
  expect(b.revokeObjectURL).toHaveBeenCalledWith('blob:capture')
  b.feed(Array.from({ length: 1000 }, () => 0.5))
  expect(frames).toHaveLength(0)
  b.feed(Array.from({ length: 2200 }, () => 0.5))
  expect(frames.map(frame => frame.byteLength)).toEqual([6400])
  const view = new DataView(frames[0]!.buffer)
  expect([view.getInt16(0, true), view.getInt16(6398, true)]).toEqual([16383, 16383])
  await b.recording.stopLive()
  expect(b.trackStop).toHaveBeenCalledOnce()
  expect(b.close).toHaveBeenCalledOnce()
  expect(b.capture.disconnect).toHaveBeenCalledOnce()
})

it('clips live samples and sends the audio no batch boundary reached', async () => {
  const b = captureFixture()
  const frames: Uint8Array[] = []
  await b.recording.startLive((batch) => { frames.push(batch) })
  b.feed([-2, 2])
  expect(frames).toHaveLength(0)
  await b.recording.stopLive()
  const view = new DataView(frames[0]!.buffer)
  expect(frames[0]!.byteLength).toBe(4)
  expect([view.getInt16(0, true), view.getInt16(2, true)]).toEqual([-32768, 32767])
})

it('sends every full batch one crossing block produces', async () => {
  const b = captureFixture()
  const frames: Uint8Array[] = []
  await b.recording.startLive((batch) => { frames.push(batch) })
  b.feed(Array.from({ length: 3300 }, () => 0.5))
  expect(frames.map(frame => frame.byteLength)).toEqual([6400])
  await b.recording.stopLive()
  expect(frames.map(frame => frame.byteLength)).toEqual([6400, 200])
})

it('reports live capture unavailable without the worklet API', async () => {
  const b = captureFixture()
  vi.stubGlobal('AudioWorkletNode', undefined)
  await expect(b.recording.startLive(() => {})).rejects.toMatchObject({ kind: 'unavailable' })
  expect(b.trackStop).not.toHaveBeenCalled()
})

it('releases live capture when the processor reports an error', async () => {
  const b = captureFixture()
  const failures: RecordingError[] = []
  await b.recording.startLive(() => {}, (failure) => { failures.push(failure) })
  b.capture.onprocessorerror?.()
  await Promise.resolve()
  expect(failures).toEqual([expect.objectContaining({ kind: 'interrupted' })])
  expect(b.trackStop).toHaveBeenCalledOnce()
  expect(b.disposed).toHaveBeenCalledOnce()
})

it('reports live capture unavailable without a media device', async () => {
  const b = captureFixture()
  vi.stubGlobal('navigator', {})
  await expect(b.recording.startLive(() => {})).rejects.toMatchObject({ kind: 'unavailable' })
})

it('contains a failing release while a processor error is reported', async () => {
  const b = captureFixture()
  const failures: RecordingError[] = []
  b.close.mockRejectedValueOnce(new Error('close failed'))
  await b.recording.startLive(() => {}, (failure) => { failures.push(failure) })
  b.capture.onprocessorerror?.()
  await Promise.resolve()
  expect(failures).toEqual([expect.objectContaining({ kind: 'interrupted' })])
  expect(b.disposed).toHaveBeenCalledOnce()
})

it('contains a failing live interruption callback', async () => {
  const b = captureFixture(), error = new Error('callback failed'), report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await b.recording.startLive(() => {}, () => { throw error })
    b.capture.onprocessorerror?.()
    await Promise.resolve()
    expect(report).toHaveBeenCalledWith('Speech recording error handler failed', error)
  } finally { report.mockRestore(); await b.recording.dispose() }
})

it('ignores a processor error raised after disposal and a block that is not audio', async () => {
  const b = captureFixture()
  const frames: Uint8Array[] = []
  const failures: RecordingError[] = []
  await b.recording.startLive((batch) => { frames.push(batch) }, (failure) => { failures.push(failure) })
  await b.recording.dispose()
  b.capture.onprocessorerror?.()
  b.capture.port.onmessage?.(new MessageEvent('message', { data: 'not audio' }))
  await Promise.resolve()
  expect(failures).toEqual([])
  expect(frames).toEqual([])
})

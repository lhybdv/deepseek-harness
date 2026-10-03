/** Browser-owned microphone capture and native Web Audio resampling. */

/** Capture failure whose message is localized by the caller. */
export class RecordingError extends Error {
  constructor(readonly kind: 'unavailable' | 'permission' | 'empty' | 'cancelled' | 'interrupted') { super(kind); this.name = 'RecordingError' }
}

/** Bytes of one live audio batch: 200 ms of 16 kHz mono PCM16. */
const BATCH_BYTES = 6400

/** Registered name of the capture processor below. */
const CAPTURE_PROCESSOR = 'dsh-capture'

/** Forwards microphone blocks to the main thread, which batches and encodes them. */
const CAPTURE_SOURCE = `class DshCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('${CAPTURE_PROCESSOR}', DshCaptureProcessor)`


/**
 * Encode mono floating-point samples as the canonical PCM16 WAV accepted by the Host.
 * @param samples - native-resampled 16 kHz mono samples.
 * @returns complete little-endian WAV bytes.
 */
export function encodeWave(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string): void => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (const [i, sample] of samples.entries()) {
    const value = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return bytes
}

/**
 * Encode the binary recording for the existing JSON Remote carrier.
 * @param bytes - complete recording.
 * @returns base64 with no data URL prefix.
 */
export function audioBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}

/** One microphone acquisition, including a permission prompt that may settle after cancellation. */
export class Recording {
  private stream: MediaStream | undefined
  private recorder: MediaRecorder | undefined
  private context: AudioContext | undefined
  private analyser: AnalyserNode | undefined
  private samples = new Float32Array(256)
  private chunks: Blob[] = []
  private worklet: AudioWorkletNode | undefined
  private batch: Uint8Array<ArrayBuffer> | undefined
  private batched = 0
  private emit: ((frames: Uint8Array<ArrayBuffer>) => void) | undefined
  private readonly lifetime = new AbortController()
  private disposal: Promise<void> | undefined

  constructor(private readonly onDispose: () => void) {}

  /**
   * Acquire the microphone, its context, the analyser and the source both capture modes share.
   * @param sampleRate - requested context rate; the default rate is used when omitted.
   * @returns the running context, the acquired stream and its source node.
   */
  private async acquire(sampleRate?: number): Promise<{ context: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode }> {
    const devices = (navigator as Partial<Navigator>).mediaDevices
    if (!devices) throw new RecordingError('unavailable')
    let stream: MediaStream
    try {
      stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new RecordingError('permission')
      throw error
    }
    if (this.lifetime.signal.aborted) { stream.getTracks().forEach((track) => { track.stop() }); throw new RecordingError('cancelled') }
    this.stream = stream
    const context = new AudioContext(sampleRate === undefined ? {} : { sampleRate })
    this.context = context
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = this.samples.length
    const source = context.createMediaStreamSource(stream)
    source.connect(this.analyser)
    return { context, stream, source }
  }

  /**
   * Acquire the microphone for one complete recording.
   * @param onError - receives failures during capture, before asynchronous resource release finishes.
   * @returns after capture starts; a cancelled permission grant immediately releases its tracks.
   */
  async start(onError?: (error: RecordingError) => void): Promise<void> {
    if (typeof MediaRecorder === 'undefined') throw new RecordingError('unavailable')
    const { stream } = await this.acquire()
    try {
      this.recorder = new MediaRecorder(stream)
      this.recorder.ondataavailable = (event) => { if (!this.lifetime.signal.aborted && event.data.size > 0) this.chunks.push(event.data) }
      this.recorder.onerror = () => {
        if (this.lifetime.signal.aborted) return
        void this.dispose().catch(() => undefined)
        try { onError?.(new RecordingError('interrupted')) } catch (error) {
          console.error('Speech recording error handler failed', error)
        }
      }
      this.recorder.start()
    } catch (error) { await this.dispose(); throw error }
  }

  /**
   * Acquire the microphone for live recognition, delivering 16 kHz mono PCM16 batches.
   * @param onFrames - receives each completed batch; the audio a final batch does not fill arrives on stop.
   * @param onError - receives failures during capture, before asynchronous resource release finishes.
   * @returns after capture starts and the first batch can be expected.
   */
  async startLive(onFrames: (frames: Uint8Array<ArrayBuffer>) => void, onError?: (error: RecordingError) => void): Promise<void> {
    if (typeof AudioWorkletNode === 'undefined') throw new RecordingError('unavailable')
    this.emit = onFrames
    try {
      const { context, source } = await this.acquire(16000)
      const module = URL.createObjectURL(new Blob([CAPTURE_SOURCE], { type: 'application/javascript' }))
      try { await context.audioWorklet.addModule(module) } finally { URL.revokeObjectURL(module) }
      const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR)
      this.worklet = node
      node.port.onmessage = (event: MessageEvent<unknown>) => { this.collect(event.data) }
      node.onprocessorerror = () => {
        if (this.lifetime.signal.aborted) return
        void this.dispose().catch(() => undefined)
        try { onError?.(new RecordingError('interrupted')) } catch (error) {
          console.error('Speech recording error handler failed', error)
        }
      }
      // A zero-gain sink keeps the graph pulling the processor without monitoring the microphone.
      const sink = context.createGain()
      sink.gain.value = 0
      source.connect(node).connect(sink).connect(context.destination)
    } catch (error) { await this.dispose(); throw error }
  }

  /**
   * Encode one microphone block into the pending batch, sending it once it is full.
   * @param data - block the capture processor posted.
   */
  private collect(data: unknown): void {
    if (!(data instanceof Float32Array)) return
    for (const sample of data) {
      const batch = this.batch ??= new Uint8Array(new ArrayBuffer(BATCH_BYTES))
      const clamped = Math.max(-1, Math.min(1, sample))
      const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
      batch[this.batched++] = value & 0xff
      batch[this.batched++] = value >> 8 & 0xff
      if (this.batched === BATCH_BYTES) this.flush()
    }
  }

  /** Send the audio captured since the last batch, if any. */
  private flush(): void {
    const batch = this.batch
    const bytes = this.batched
    if (batch === undefined || bytes === 0) return
    this.batch = undefined
    this.batched = 0
    this.emit?.(bytes === BATCH_BYTES ? batch : batch.slice(0, bytes))
  }

  /**
   * Read the live microphone signal.
   * @returns the measured RMS level, or zero outside capture.
   */
  amplitude(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const sample of this.samples) sum += sample * sample
    return Math.sqrt(sum / this.samples.length)
  }

  /**
   * Finish capture and resample the recording.
   * @param maxDurationSeconds - truncate timer overshoot to the Host limit.
   * @returns one recording after the final MediaRecorder chunk arrives.
   */
  async stop(maxDurationSeconds: number): Promise<Uint8Array<ArrayBuffer>> {
    const recorder = this.recorder
    const context = this.context
    if (!recorder || !context || recorder.state !== 'recording') { await this.dispose(); throw new RecordingError('empty') }
    try {
      await new Promise<void>((resolve, reject) => {
        recorder.onstop = () => { resolve() }
        recorder.onerror = () => { reject(new RecordingError('empty')) }
        recorder.stop()
      })
      this.stream?.getTracks().forEach((track) => { track.stop() })
      this.lifetime.signal.throwIfAborted()
      const blob = new Blob(this.chunks, { type: recorder.mimeType })
      if (blob.size === 0) throw new RecordingError('empty')
      const decoded = await context.decodeAudioData(await blob.arrayBuffer())
      this.lifetime.signal.throwIfAborted()
      const offline = new OfflineAudioContext(1, Math.max(1, Math.floor(Math.min(decoded.duration, maxDurationSeconds) * 16000)), 16000)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const resampled = await offline.startRendering()
      this.lifetime.signal.throwIfAborted()
      return encodeWave(resampled.getChannelData(0))
    } finally { await this.dispose() }
  }

  /**
   * Finish live capture, sending the audio no batch boundary reached.
   * @returns after the microphone and its context are released.
   */
  async stopLive(): Promise<void> {
    this.flush()
    await this.dispose()
  }

  /**
   * Release this recording and invalidate pending permission grants.
   * @returns the shared release promise, including any AudioContext close failure.
   */
  dispose(): Promise<void> {
    if (!this.disposal) {
      const closing = Promise.withResolvers<void>()
      this.disposal = closing.promise
      void this.release().then(closing.resolve, closing.reject)
    }
    return this.disposal
  }

  private async release(): Promise<void> {
    this.lifetime.abort(new RecordingError('cancelled'))
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.stream?.getTracks().forEach((track) => { track.stop() })
    this.stream = undefined
    this.worklet?.disconnect()
    this.worklet = undefined
    this.emit = undefined
    this.batch = undefined
    this.batched = 0
    const context = this.context
    this.context = undefined
    this.analyser = undefined
    this.chunks = []
    try { if (context && context.state !== 'closed') await context.close() }
    finally { this.onDispose() }
  }
}

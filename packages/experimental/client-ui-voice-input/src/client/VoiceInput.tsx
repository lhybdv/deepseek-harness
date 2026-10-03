/** Voice input and latest-answer speech playback controls. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranscriptionRequest, TranscriptionStreamRequest, SpeechAudioChunk } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SynthesisRequest, SynthesisResult } from '@deepseek-ai/dsh-api-text-to-speech/types'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSegment, SpeechSelection, SpeechSelectionPatch, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import { RecordingError, audioBase64, type Recording } from './audio.ts'
import type { SpeechReadiness } from './readiness.ts'
import { Waveform } from './Waveform.tsx'
import { VoiceSetupDialog } from './VoiceSetupDialog.tsx'
import { NS } from './locales.ts'
import { Button, IconCloseOutlineRegular, IconStopFillRegular, IconMicrophoneOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './VoiceInput.module.css'

/** Host calls injected without exposing a Cordis Context to React. */
export interface VoiceInputActions {
  /** Open the voice bundle details without starting preparation. */
  openSettings: () => void
  /** @returns one microphone operation owned by the plugin lifecycle. */
  createRecording: () => Recording
  transcribe: (request: TranscriptionRequest, signal: AbortSignal) => Promise<RemoteResult<Transcript>>
  /** Open live recognition whose uplink carries captured audio and whose downlink reports text. */
  transcribeStream: (request: TranscriptionStreamRequest, signal: AbortSignal) => RemoteStreamHandle<SpeechSegment, SpeechAudioChunk>
  /** Synthesize one assistant response. */
  synthesize: (request: SynthesisRequest, signal: AbortSignal) => Promise<RemoteResult<SynthesisResult>>

  prepare: (providerId: SpeechProviderId, options?: SpeechPreparationOptions) => Promise<void>
  cancelPreparation: (providerId: SpeechProviderId) => Promise<void>
  configure: (patch: SpeechSelectionPatch) => Promise<void>
}

/** Entry-injected Host readiness and microphone operations. */
export interface VoiceInputInjected extends VoiceInputActions {
  hooks: { speechReadiness: HostObservable<SpeechReadiness> }
}

/** Composer-owned expansion and draft actions; preferences stay in plugin settings. */
export type VoiceInputProps = Pick<PropsRuntime<'conversation.input.activity'>, 'sessionId' | 'inputActions' | 'locked' | 'onActiveChange' | 'useChat'>
  & PropsLocale<typeof NS> & InjectFace<VoiceInputInjected>

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'feedback'

/** One open live recognition stream; its reports replace the text still being recognized. */
interface LiveStream {
  readonly handle: RemoteStreamHandle<SpeechSegment, SpeechAudioChunk>
  /** Settles with the last reported transcript once the stream ends. */
  readonly settled: Promise<string>
}

interface ActiveRecording {
  readonly capture: Recording
  readonly abort: AbortController
  readonly span: TokenSpan
  readonly selection: SpeechSelection
  readonly maxDurationSeconds: number
  readonly maxAudioBytes: number
  phase: 'requesting' | 'recording' | 'transcribing'
  /** Present when the selected provider reports text while the recording is still being produced. */
  live?: LiveStream | undefined
  timer?: ReturnType<typeof setTimeout> | undefined
}

async function disposeRecording(capture: Recording): Promise<void> {
  try { await capture.dispose() } catch (_error) {
    // Tracks stop before AudioContext.close(); a close failure must not hide the recording result.
  }
}
/** Read the latest settled assistant answer from the live Chat snapshot. */
function latestAnswer(snapshot: ChatSnapshot): string {
  for (let index = snapshot.order.length - 1; index >= 0; index--) {
    const node = snapshot.nodes.get(snapshot.order[index]!)
    if (node?.kind !== 'assistant-step') continue
    const data = (node as ChatNode<'assistant-step'>).data
    if (data.status !== 'settled') continue
    return data.blocks.filter(block => block.kind === 'text').map(block => block.text).join('').trim()
  }
  return ''
}

/** Render a compact microphone or an expanded capture, transcription, or retry row. */
export function VoiceInput({ sessionId, inputActions, locked, onActiveChange,
  createRecording, transcribe, transcribeStream, synthesize, openSettings, useSpeechReadiness, useChat, t }: VoiceInputProps) {
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  const provider = catalog?.providers.find(item => item.id === catalog.selection.providerId)
  const usable = readiness.connected && (provider?.preparation.phase === 'ready' || provider?.preparation.phase === 'standby'
    || provider?.preparation.phase === 'waking')
  const answer = useChat(snapshot => latestAnswer(snapshot))
  const [phase, setPhase] = useState<Phase>('idle'), [message, setMessage] = useState(''), [pending, setPending] = useState('')
  const [liveText, setLiveText] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)
  const [synthesisPending, setSynthesisPending] = useState(false), [playback, setPlayback] = useState<'idle' | 'playing' | 'paused'>('idle')
  const audio = useRef<HTMLAudioElement>(), audioUrl = useRef<string>(), synthesisAbort = useRef<AbortController>(), synthesisRun = useRef(0)
  useEffect(() => { if (usable) setSetupOpen(false) }, [usable])
  const current = useRef<ActiveRecording>(), generation = useRef(0)
  const expanded = phase !== 'idle'
  useLayoutEffect(() => { onActiveChange(expanded); return () => { onActiveChange(false) } }, [expanded, onActiveChange])
  const stopPlayback = (): void => {
    synthesisRun.current++
    synthesisAbort.current?.abort()
    synthesisAbort.current = undefined
    audio.current?.pause()
    audio.current = undefined
    if (audioUrl.current !== undefined) URL.revokeObjectURL(audioUrl.current)
    audioUrl.current = undefined
    setPlayback('idle'); setSynthesisPending(false)
  }
  useEffect(() => { stopPlayback(); return stopPlayback }, [answer, sessionId])
  const playAnswer = async (): Promise<void> => {
    if (synthesisPending || answer === '') return
    if (audio.current !== undefined && playback === 'playing') { audio.current.pause(); setPlayback('paused'); return }
    if (audio.current !== undefined && playback === 'paused') { await audio.current.play(); setPlayback('playing'); return }
    const run = ++synthesisRun.current, abort = new AbortController()
    synthesisAbort.current = abort
    setSynthesisPending(true)
    try {
      setMessage('')
      const result = await synthesize({ text: answer }, abort.signal)
      if (run !== synthesisRun.current) return
      if (!result.ok) throw result.error
      const binary = atob(result.value.audioBase64)
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: result.value.mimeType }))
      audioUrl.current = url
      const player = new Audio(url)
      audio.current = player
      player.addEventListener('ended', stopPlayback, { once: true })
      player.addEventListener('error', () => { stopPlayback(); setMessage(t('playbackFailed')) }, { once: true })
      await player.play()
      setPlayback('playing')
    } catch {
      if (run === synthesisRun.current) { stopPlayback(); setMessage(t('playbackFailed')) }
    } finally { if (run === synthesisRun.current) { synthesisAbort.current = undefined; setSynthesisPending(false) } }
  }

  const cancel = (): void => {
    generation.current++
    const active = current.current
    current.current = undefined
    if (active) {
      clearTimeout(active.timer)
      active.live?.handle.dispose()
      active.abort.abort()
      void disposeRecording(active.capture)
    }
    setPending(''); setMessage(''); setLiveText(''); setPhase('idle'); setSetupOpen(false)
  }
  useEffect(() => {
    setPending(''); setMessage(''); setPhase('idle'); setSetupOpen(false)
    const blur = (): void => { if (current.current?.phase === 'recording') cancel() }
    const visibility = (): void => {
      if (document.hidden && current.current && current.current.phase !== 'transcribing') cancel()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && current.current) { event.preventDefault(); cancel() }
    }
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('keydown', escape)
      generation.current++
      const active = current.current
      current.current = undefined
      if (active) {
        clearTimeout(active.timer)
        active.live?.handle.dispose()
        active.abort.abort()
        void disposeRecording(active.capture)
      }
    }
  }, [sessionId])

  const feedback = (text: string): void => { setMessage(text); setPhase('feedback') }
  const failureText = (failure: unknown): string => failure instanceof RecordingError ? t(failure.kind)
    : t('failed', { message: failure instanceof Error ? failure.message : String(failure) })
  /** Open the live stream and show each report; a failure before stop releases the microphone and reports it. */
  const openLive = (run: number, selection: SpeechSelection, abort: AbortController): LiveStream => {
    const handle = transcribeStream({ providerId: selection.providerId, language: selection.language }, abort.signal)
    const settled = (async (): Promise<string> => {
      let text = ''
      for await (const report of handle) {
        text = report.text
        if (run === generation.current) setLiveText(text)
      }
      return text
    })()
    void settled.catch((failure: unknown) => {
      const active = current.current
      if (run !== generation.current || active === undefined || active.phase === 'transcribing') return
      current.current = undefined
      clearTimeout(active.timer)
      handle.dispose()
      void disposeRecording(active.capture)
      feedback(failureText(failure))
    })
    return { handle, settled }
  }
  const finish = async (): Promise<void> => {
    const active = current.current
    if (!active || active.phase !== 'recording') return
    active.phase = 'transcribing'
    const run = generation.current
    clearTimeout(active.timer); setPhase('transcribing')
    try {
      let text: string
      if (active.live === undefined) {
        const audio = await active.capture.stop(active.maxDurationSeconds)
        if (run !== generation.current) return
        if (audio.byteLength > active.maxAudioBytes) { feedback(t('tooLarge')); return }
        const result = await transcribe({ audioBase64: audioBase64(audio), ...active.selection }, active.abort.signal)
        if (run !== generation.current) return
        if (!result.ok) { feedback(t('failed', { message: result.error.message })); return }
        text = result.value.text
      } else {
        await active.capture.stopLive()
        if (run !== generation.current) return
        active.live.handle.end()
        text = await active.live.settled
      }
      if (run !== generation.current) return
      if (text === '') { feedback(t('empty')); return }
      if (!inputActions.insertText(text, active.span)) { setPending(text); feedback(t('conflict')); return }
      setPhase('idle')
    } catch (failure) {
      await disposeRecording(active.capture)
      if (run === generation.current) feedback(failureText(failure))
    } finally { if (run === generation.current) current.current = undefined }
  }
  const start = async (): Promise<void> => {
    if (!catalog || !usable || locked || current.current) return
    const run = ++generation.current
    const active: ActiveRecording = { capture: createRecording(), abort: new AbortController(),
      span: inputActions.captureInsertion(), selection: catalog.selection,
      maxDurationSeconds: catalog.maxDurationSeconds, maxAudioBytes: catalog.maxAudioBytes, phase: 'requesting' }
    current.current = active
    setMessage(''); setPending(''); setLiveText(''); setPhase('requesting')
    const onCaptureFailure = (failure: RecordingError): void => {
      if (run !== generation.current || current.current !== active || active.phase === 'transcribing') return
      current.current = undefined
      clearTimeout(active.timer); active.abort.abort(); active.live?.handle.dispose()
      feedback(failureText(failure))
    }
    try {
      if (provider.streaming) {
        const live = openLive(run, active.selection, active.abort)
        active.live = live
        await active.capture.startLive((frames) => {
          if (run === generation.current && current.current === active) live.handle.send({ audioBase64: audioBase64(frames) })
        }, onCaptureFailure)
      } else {
        await active.capture.start(onCaptureFailure)
      }
      if (run !== generation.current || current.current !== active) return
      active.phase = 'recording'
      setPhase('recording')
      active.timer = setTimeout(() => { void finish() }, active.maxDurationSeconds * 1000)
    } catch (failure) {
      await disposeRecording(active.capture)
      if (run === generation.current) { current.current = undefined; feedback(failureText(failure)) }
    }
  }
  if (!expanded) return <>
    <Tooltip label={t('dictate')} disabled={!usable} side="top" portal>
      <span className={css.triggerAnchor}><Button className={css.trigger} size="sm" disabled={locked}
        aria-label={t(usable ? 'start' : 'setupPrompt.trigger')} aria-haspopup={usable ? undefined : 'dialog'}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { if (usable) void start(); else setSetupOpen(true) }}><IconMicrophoneOutlineRegular size={18} /></Button></span>
    </Tooltip>
    <Tooltip label={t(playback === 'playing' ? 'pauseAnswer' : 'playAnswer')} side="top" portal>
      <span className={css.triggerAnchor}><Button className={css.trigger} size="sm" type="button"
        disabled={answer === '' || synthesisPending} aria-label={t(playback === 'playing' ? 'pauseAnswer' : 'playAnswer')}
        onClick={() => { void playAnswer() }}>
        {playback === 'playing' ? <IconPauseOutlineRegular size={18} /> : <IconPlayOutlineRegular size={18} />}
      </Button></span>
    </Tooltip>
    {message !== '' && <span className={css.activityMessage} role="status">{message}</span>}
    {playback !== 'idle' && <Tooltip label={t('stopAnswer')} side="top" portal>
      <span className={css.triggerAnchor}><Button className={css.trigger} size="sm" type="button"
        aria-label={t('stopAnswer')} disabled={synthesisPending} onClick={stopPlayback}><IconStopFillRegular size={16} /></Button></span>
    </Tooltip>}
    <VoiceSetupDialog open={setupOpen && !usable}
      needsInstallation={readiness.connected && provider?.location === 'host-local' && provider.preparation.phase === 'unprepared'}
      onDismiss={() => { setSetupOpen(false) }} onOpenDetails={() => { setSetupOpen(false); openSettings() }} t={t} />
  </>
  return <div className={css.captureRow} data-voice-activity={phase}>
    <Button type="button" className={css.roundButton} size="sm" aria-label={t(pending ? 'discard' : 'cancel')}
      onClick={cancel}><IconCloseOutlineRegular size={14} /></Button>
    {phase === 'recording' && <Waveform recording={current.current?.capture} label={t('recording')} />}
    {phase === 'recording' && current.current?.live !== undefined
      && <span className={css.liveText} role="status" title={liveText}>{liveText || t('listening')}</span>}
    {phase !== 'recording'
      && <span className={css.activityMessage} role="status" title={pending || message}>
        {(phase === 'requesting' || phase === 'transcribing') && <StateDot state="ongoing" />}
        {phase === 'feedback' ? message : t(phase === 'requesting' ? 'requesting'
          : provider?.preparation.phase === 'waking' ? 'wakingShort' : 'transcribingShort')}</span>}
    {phase === 'recording' && <Button type="button" className={css.roundButton} size="sm" aria-label={t('stop')}
      onClick={() => { void finish() }}><IconStopFillRegular size={14} /></Button>}
    {phase === 'feedback' && (pending
      ? <Button className={css.inlineAction} size="sm" type="button" onClick={() => {
        if (inputActions.insertText(pending, inputActions.captureInsertion())) { setPending(''); setPhase('idle') }
      }}>{t('insert')}</Button>
      : <Button className={css.roundButton} size="sm" type="button" aria-label={t('retryRecording')} disabled={!usable || locked}
        onClick={() => { void start() }}><IconMicrophoneOutlineRegular size={18} /></Button>)}
  </div>
}

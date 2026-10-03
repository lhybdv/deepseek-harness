# Agent Note: Live speech recognition while the user is still speaking

Status: implemented

English | [中文](2026-10-02-live-speech-recognition.zh.md)

## Problem

Voice input recognized one complete recording. The browser captured the whole utterance with `MediaRecorder`, resampled it into a canonical 16 kHz WAV, and sent it after the user stopped; only then did the Host open a recognizer session and replay the audio in real time. A ten-second question therefore showed nothing for ten seconds, and the second half of that wait existed only because a stored file was being replayed at speaking speed. The cloud recognizer reports sentences while it hears them — its interim sentences are corrected in place — and those reports had nowhere to go: the seam exposed `transcribe(input) → Promise<Transcript>`, the Remote exposed one unary call, and the composer row had one "transcribing" state.

## Decision

The seam gains an optional live operation beside the stored one. `SpeechProvider.transcribeStream(input, signal)` consumes `SpeechStreamInput.chunks` and yields `SpeechSegment` values; each report restates the whole transcript, and the last one is final. `SpeechProviderInfo.streaming` states whether a provider implements it, so a caller chooses the path before it starts capturing. `speechToText.resolveStream()`/`stream()` mirror `resolve()`/`transcribe()`: the same registration ownership, the same explicit provider pinning, the same refusal to fall back, and a registration withdrawal aborts and joins a live session exactly as it does a stored one. A provider without the operation makes `stream()` fail rather than silently recognizing a complete recording.

The Remote carries the live recording on one logical stream: `speech.transcribeStream()` returns `RemoteStream<SpeechSegment, SpeechAudioChunk>` from the Host and a `RemoteStreamHandle` in the browser, so the Client sends base64 PCM16 batches up the uplink and reads reports from the downlink of the same call. The API validates each batch — canonical base64, whole PCM16 samples — and holds the streamed total to the same `maxAudioBytes`/`maxDurationSeconds` limits as a stored recording. This is the first shipped use of the protocol's duplex stream, which already existed for exactly this shape of problem.

The browser captures with an AudioWorklet whose processor module is built from an inline string and loaded through a Blob URL, on an `AudioContext` created at 16 kHz so the graph delivers the rate the recognizer expects; the media source still feeds the existing analyser, so the waveform keeps working, and a zero-gain sink keeps the processor pulled without monitoring the microphone. Batches of 200 ms are converted to Int16 and sent as the uplink fills; stopping flushes the remaining audio, ends the uplink, and inserts the settled report through the same revision-guarded span the stored path uses.

The live transcript renders in the recording row and replaces itself on every report. The composer draft keeps its existing contract: one insertion, at stop, through `InputActions.insertText()`.

## Alternatives considered

**Recognize in the browser, as the reference implementation does.** The page would sign and speak to the service directly, which puts the account secret in every browser and duplicates the transport. The duplex Remote keeps the secret on the Host, reuses the authenticated connection the client already has, and leaves one implementation for the Web and desktop clients.

**Send audio through the unary call in chunks.** Each call would open its own recognizer session, so sentences could not be corrected across chunk boundaries and the service would lose the context that makes its interim reports useful. Concatenating per-chunk transcripts also changes what the user hears into what the model guessed twice.

**Have the client type every interim report into the composer draft.** The draft is the user's editable buffer: replacing a region of it repeatedly while they type needs a new editing operation and a rule for what happens when their own edit lands inside the recognized span. Showing the live text in the row leaves the draft untouched until the single insertion at stop, which is also where the user's attention is when the recording ends.

**Wait for the local SenseVoice provider to stream.** Its recognizer is an offline model that consumes a complete recording; giving it streaming would need a VAD-driven partial-decode design of its own. Advertising `streaming` per provider lets the local recognizer keep its current behaviour while the cloud provider streams today.

## Consequences

A live recording no longer buffers an utterance on either side: audio leaves the browser as it is captured and reaches the recognizer at speaking speed, so text appears roughly with the service's own latency instead of after the recording ends and is replayed. Cancelling mid-sentence now stops both the capture and the recognizer session.

The seam, the Remote and the UI each gained a second path, and the composer row gained a live-text element. Live recognition is available only where a provider advertises it, so a deployment on the local recognizer observes the previous behaviour — one transcribing state after stop — and the row still has to render that. The uplink carries base64 on a JSON carrier, which costs a third more bytes than the PCM it encodes; the batch size trades that overhead against latency.

## Testing

`packages/experimental/speech-to-text/tests/` covers the live seam (reports in order, a provider without the operation, a withdrawn registration, a withdrawn session's signal), `speech-to-text-rtasr/tests/` covers the provider's live session (frame re-framing, reports while frames still arrive, the byte limit, drain, cancellation, service errors) and `api-speech-to-text/tests/` covers the Remote (decoding and limits per batch, error mapping, cancellation, a call outside a Remote invocation), all at 100% per-file coverage. The client package covers the capture (batch boundaries, tail flush, module URL lifecycle, processor error) and the component (report rendering, settled insertion, cancel disposal, the non-streaming fallback). The demo profile was exercised with a Chromium fake audio device feeding a synthesized Chinese sentence, and the row showed the sentence forming and correcting while the recording was still running.

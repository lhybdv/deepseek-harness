---
description: "iFlytek RTASR cloud recognition over one signed WebSocket session per recording."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-speech-to-text-rtasr

English | [中文](README.zh.md)

## Summary

This cloud provider recognizes speech with the iFlytek real-time transcription service (RTASR). The Host signs one WebSocket session per recording, delivers the recording's PCM frames in real time, and returns the text the service reports. No model is downloaded and nothing is prepared on disk; the service holds the recognizer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it beside the [speech service](../speech-to-text/README.md) with a provider registration and the deployment's own credentials. It registers under `providerId` (default `iflytek-rtasr`) and accepts the language hints `auto`, `zh` and `en`, which map to the service's `autodialect`, `cn` and `en` parameters.

`appId` and `accessKeyId` come from the section when set, otherwise from `IFLYTEK_RTASR_APP_ID` and `IFLYTEK_RTASR_ACCESS_KEY_ID`. `accessKeySecretRef` names the credential that holds the access key secret and defaults to `IFLYTEK_RTASR_ACCESS_KEY_SECRET`; the value is resolved once per recording through `ctx.credentials`, falling back to the launch environment, so a secret stored after the Host booted applies to the next recording without a restart. A missing identifier or secret fails the recording with a message naming the field, and never a silent fallback to another recognizer.

`baseWsUrl` defaults to the documented endpoint and accepts a `ws` origin for tests against a local service. `maxAudioBytes` and `maxResponseBytes` bound one recording and one decoded service message. `connectTimeoutMs` bounds establishing the session and `drainTimeoutMs` bounds the wait for the final result after the last frame.

The provider needs no preparation, so the voice UI offers it as immediately ready and never shows the setup or download surfaces that a host-local recognizer uses.

It advertises `streaming`, so a caller may send frames while it is still capturing audio instead of waiting for a complete recording. Reports then arrive with the service's own latency, and the recording never has to be held in one buffer on either side.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

Signing follows the service contract: the session parameters, sorted by name and percent-encoded, are signed with HMAC-SHA1 under the access key secret, and a Beijing-time `utc` with a `+0800` offset is part of the signed set. Frame size (1280 bytes: 16 kHz, 16-bit, mono, 40 ms) and pacing (one frame each 40 ms, so audio reaches the service in real time) are service protocol constants, not deployment settings. A recording longer than its deadline is bounded by the caller's cancellation, which closes the socket.

The transcript is assembled from the service's sentence stream: a final sentence extends the text and an interim sentence replaces the sentence still being recognized, so a service that stops without finalizing its last sentence still contributes that text. After the end marker the provider waits for the service to close; the drain deadline ends that wait without discarding the transcript, while caller cancellation propagates. A service error frame, a transport failure, or a close before the recording was delivered rejects the recording instead of reporting a short transcript as complete, and the connection always closes before settlement.

The service's frame stream was observed directly: an `action: "started"` frame carries the session id in `data.sessionId`, result frames type the sentence as a JSON string (`"0"` final, `"1"` interim), and final sentences arrive one clause at a time with their punctuation, so the text appends verbatim. `st.ed` is a millisecond offset rather than a completion marker; reading it as one resets the transcript on every frame.

Live recording reuses that session: the caller's frames are delivered as they arrive, without the 40 ms pacing the stored path needs, because the caller already produces audio in real time. A report is sent whenever the assembled transcript changes, and the recording ends with the settled text once the end marker returns or the drain deadline expires.

The service receives raw PCM without the canonical WAV header, which the input step strips while validating the header, the byte limit and the accepted language. Audio must be backed by an `ArrayBuffer`, which the connection's binary send requires.

No runtime invariant companion is published because the provider owns no independently observable state: its only durable fact is the registration the speech service already tracks.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as recordings remain outside model requests; ordinary user submission owns any later text.

#### KV Cache effect

No direct effect; ordinary submission owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Recognition is a cloud call: the recording leaves the Host for the service, which must be reachable from the Host and licensed for the deployment's account.
- Only the settled transcript reaches the composer; the recording row shows the reports the service produces while the user is still speaking. Interim sentences shape the final text and replace each other as the service refines them.
- `auto` selects the service's dialect mode, whose accuracy depends on the account's purchased capabilities; the provider cannot detect which the account holds.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

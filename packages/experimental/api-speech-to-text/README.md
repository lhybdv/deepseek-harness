---
description: "Expose bounded transient transcription through the authenticated Web Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-api-speech-to-text

English | [中文](README.zh.md)

## Summary

The `speech` Remote connects browser recordings to `ctx.speechToText`. It exposes provider discovery, one complete-recording transcription call, and one live stream for providers that report text while the user is still speaking.

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

Compose with the speech Service Definition and Typert. `maxAudioBytes` and `maxDurationSeconds` limit accepted recordings. The browser UI mounts this package’s generated `/remote` contribution when enabled.

`prepare(providerId, { downloadSource })` forwards one advertised source to the provider; omission keeps its configured policy. The catalog carries `downloadSources` for the picker. The provider rejects unavailable choices and changes to an active task’s source.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`catalog()` exposes provider identities, the default selection and recording limits. `transcribe()` validates canonical base64 and 16 kHz mono PCM16 WAV before resolving the selected provider. The existing gateway owns authentication and cancellation transport. Audio is transient, never a Session event or attachment; only the user’s later ordinary submission records recognized text. No runtime invariant companion is published because validation is stateless and preparation belongs to the provider.

`transcribeStream()` carries the live recording on one logical stream: the Client sends base64 PCM16 batches as its uplink, and the Host yields the recognizer’s reports down the same stream. Each decoded batch must be canonical base64 and a whole number of PCM16 samples, and the accumulated total is held to the same `maxAudioBytes` and `maxDurationSeconds` limits as a stored recording; a refused batch fails the stream with `speech/invalid-audio` rather than reaching the recognizer. Recognition failures arrive as `speech/transcription-failed`, while Client cancellation propagates unchanged.

`follow()` streams complete catalogs, including preparation states and current preferences. `prepare()` starts or joins a Host task; `cancelPreparation()` explicitly cancels it. `configure()` persists the supplied preference fields. A disconnected observer does not cancel preparation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as recordings and preparation remain outside model requests; ordinary user submission owns any later text.

#### KV Cache effect

No direct effect; ordinary submission owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No file upload or persistent transcript history is exposed. Base64 adds transport overhead to both calls; recordings remain bounded by the advertised limits. Live recognition depends on the selected provider advertising `streaming`.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

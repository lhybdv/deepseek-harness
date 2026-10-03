# Agent Note: Cloud speech recognition as a switched-off provider

Status: implemented

English | [中文](2026-10-01-cloud-speech-recognition-provider.zh.md)

## Problem

The [voice input stack](2026-09-16-experimental-voice-input.md) shipped one recognizer: a host-local SenseVoice model the Host downloads and runs on the CPU. A deployment that must not download roughly 240 MB of weights, or that already owns a speech account it is licensed to use, had no path to voice input at all. The speech service accepts any number of providers, but nothing in the tree registered a cloud one, and experimental capability reaches an installation only through the bundles `OPTIONAL_BUNDLES` ships switched off.

## Decision

`packages/experimental/speech-to-text-rtasr/` registers a second recognizer for `ctx.speechToText` through the iFlytek real-time transcription service (RTASR). One recording owns one signed WebSocket session: the provider percent-encodes and sorts the session parameters, signs them with HMAC-SHA1 under the access key secret, adds a Beijing-time `utc`, delivers the recording's PCM in 1280-byte frames paced one per 40 ms so audio arrives in real time, repeats the service's session id in the end marker, and assembles the sentence stream into one `Transcript`. Final sentences extend the text and interim sentences replace the sentence still being recognized, so a service that stops without finalizing its last sentence still contributes that text. Frame size, pacing, and the endpoint family are protocol constants; the endpoint, byte limits, and deadlines are configuration.

Credentials reach the provider without entering a configuration file: `appId` and `accessKeyId` come from the section or `IFLYTEK_RTASR_APP_ID` / `IFLYTEK_RTASR_ACCESS_KEY_ID`, and the access key secret is a *reference* resolved once per recording through `ctx.credentials`, falling back to the launch environment. A secret stored after the Host booted therefore applies to the next recording, and a missing value fails that one recording with the field named instead of falling back to another recognizer.

The provider ships with `voice-input-bundle` and **switched off**. Its manifest declares the package as a dependency, its patch inserts the row with `disabled: true`, and local SenseVoice stays the selected recognizer, so enabling voice input changes nothing until someone enables that row and selects it. `apps/cli/config/examples/meteo/cordis.yml` does exactly that for the demonstration, by id: `- id: speech-to-text-rtasr` with `disabled: false`, plus `- id: speech-to-text` setting `defaultProvider`. Both patches name no package, so the composition gates stay satisfied, and the Loader warns once per missing id and continues while the bundle is off.

## Alternatives considered

**Recognize in the browser, as the reference implementation does.** The page would sign the request itself, which means shipping the access key secret to every browser and requiring each page to reach the service directly. The Host signs and streams instead: the secret stays on the Host, the browser keeps only microphone capture and draft insertion, and one provider serves the Web and desktop clients.

**Ship the cloud row enabled in the bundle.** Every installation that enables voice input would advertise a recognizer that fails until someone supplies an account, and the composed-plugin inventory — including the recorded expectations of the voice Web tests — would change for installations that never wanted cloud recognition. A switched-off row keeps the composed set identical until a deployment opts in.

**A separate cloud-recognition bundle.** A second optional bundle needs its own icon and locale metadata and would duplicate the speech service, the Remote, and the browser microphone rows that already make up the voice bundle; two bundles could then be enabled into a conflicting pair. The cloud recognizer is a provider of an existing seam, not a second capability.

**Declare the provider as a dependency of `apps/cli` and insert the rows from the example overlay.** The default-product isolation gate refuses experimental packages in the installation's runtime dependencies, and the bundle's own dependencies are what an application overlay resolves through. Routing the dependency through the bundle keeps the installation's dependency surface unchanged and states the real relationship: the recognizer belongs to the voice bundle.

**Stream interim sentences to the browser.** This was rejected when the cloud provider shipped: the seam returned one `Transcript` per recording and the Remote carried no incremental channel, so a display-only improvement would have changed the Service Definition, the Remote, and the composer state machine. The [live recognition decision](2026-10-02-live-speech-recognition.md) later reversed that call — the seam, the Remote and the client gained the live path, and the interim text the service already produced is now what the recording row shows while the user is still speaking.

## Consequences

Recognition now depends on a cloud service the Host must reach, and recordings leave the Host: a deployment must license the account, and the service's dialect mode is only as good as that license. The provider adds a real-time round trip, so a ten-second question takes at least ten seconds to deliver, where local inference answers sooner. Only the settled transcript reaches the composer; the reports the service produces while the user is still speaking stay in the recording row, as the [live recognition decision](2026-10-02-live-speech-recognition.md) describes.

In exchange, a deployment with no appetite for local model weights, or with an existing iFlytek account, gets the same seam, the same microphone UI, the same draft-insertion semantics, and no model download: the provider reports itself ready without preparation, so the voice UI never shows the setup or download surfaces. The local recognizer keeps its position as the default, so the bundle's existing users observe no change.

## Testing

`packages/experimental/speech-to-text-rtasr/tests/` covers signing (fixed HMAC vector, sorted and percent-encoded parameters, Beijing timestamp), wire decoding (documented result and error frames, malformed frames, oversized frames), and the session (paced frames, session id in the end marker, interim-only transcripts, drain deadline, service errors, transport failures, every cancellation path) against a scripted connection, at 100% per-file coverage. The default WebSocket adapter is exercised over a real socket against a local service. The provider was also run against the live iFlytek service with synthesized Chinese speech: eleven service frames assembled the spoken sentence verbatim, with `st.type` arriving as the string `"1"` for interim sentences and `"0"` for final ones, the rule the assembly follows.

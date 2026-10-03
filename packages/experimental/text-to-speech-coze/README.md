---
description: "Coze cloud speech synthesis with Host-side named credentials."
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech-coze

English | [中文](README.zh.md)

## Summary

Registers Coze's `/v1/audio/speech` endpoint as a cloud provider for the experimental text-to-speech service.

## Use this package

Configure `credentialRef`, `baseUrl`, `voiceId`, and `emotion`. Store the bearer token in the Host credentials service under the configured reference. Requests resolve the secret at synthesis time; it is never included in browser code or configuration.

## Request

Coze receives `{ voice_id, input, emotion }` as JSON and must return non-empty `audio/mpeg` bytes. HTTP failures and unavailable credentials reject the request.

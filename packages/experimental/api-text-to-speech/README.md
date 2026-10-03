---
description: "Authenticated experimental speech synthesis for browser clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-text-to-speech

English | [中文](README.zh.md)

## Summary

The `speechSynthesis` Remote namespace sends text to the Host provider and returns base64-encoded audio bytes. Calls do not activate an Agent or add Session events.

## Use this package

Mount the generated Remote contribution in a Client, and configure `maxTextLength` on the Host. Empty or oversized text is refused before provider execution. Provider errors are returned as typed Remote errors.

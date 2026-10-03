---
description: "Named experimental speech synthesis providers and Host-owned cancellation."
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech

English | [中文](README.zh.md)

## Summary

This Service Definition selects one speech synthesis provider through `ctx.speechSynthesis`. Provider registrations are Host-owned, disposable, and cancel accepted work when withdrawn.

## Use this package

Configure `defaultProvider` and load the matching provider plugin. Call `synthesize({ text }, signal)` from a Host-side consumer; no credentials or provider-specific fields cross the browser boundary.

## Understand the implementation

Each request uses the exact configured provider. Registration disposal closes admission, aborts active synthesis and joins its settlement.

## Known limitations

The provider contract returns encoded bytes; a Remote consumer is responsible for safe transport encoding.

---
description: "Remote access to meteorological document products."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-document-products

English | [中文](README.zh.md)

## Summary

The `documentProducts` Remote namespace exposes session-scoped generation, listing, lifecycle actions, and immutable publication releases.

## Use this package

Mount the Host contribution alongside `@deepseek-ai/dsh-document-products`. Clients can generate drafts, submit them for review, approve or reject them, publish versioned releases, and archive published products. Transitions retain the supplied actor and timestamp. Every product the namespace answers with carries the actions its current state allows, as the transition table that owns the state machine reports them, so a client offers exactly those controls instead of re-deriving legality.

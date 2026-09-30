---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-01-meteo-focus

English | [中文](2026-10-01-meteo-focus.zh.md)

## Summary

Adds the `meteo/focus` event root: the whole-value consultation focus — an optional station id, an optional crop, and the instant the turn recorded them — that a meteorology consultation writes when it settles the place the session is about. The event carries the complete value rather than a delta, so folding the log from `init` needs no earlier write.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-01-meteo-focus
baseline: false
changes:
  - root: "event:meteo/focus"
    previous: null
    after: "3ca5e246d02c806e0bfb8c55b11b7d7d3346a4c26406f4b44a385b2485beb804"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The root is additive. No header, envelope, or existing event value changes, and `SessionHeader.version` stays as it is. `meteo/focus` is required on read rather than ignorable: it is the anchor every later consultation tool call reads, so a build that does not know the type refuses the log instead of silently dropping an event that changes what a later step answers. Replaying a log that carries no such event yields the projection's `init` value, `null`, which is the state every reader held before this package existed. The `meteoFocus` projection belongs to `dsh-meteo-data`, so a composition without that plugin neither writes nor reads the root.

<a id="verification"></a>
## Verification

pnpm run typecheck passed both compiler faces. pnpm exec vitest run packages/meteo packages/api/meteo-controller packages/bundle/meteo-app passed 321 tests across 17 files, covering the focus projection's fold, release, and replay cases. pnpm run verify-persistence-changes accepts this root as a same-version addition, and pnpm run verify-persistence-formats verifies the v0 through v4 references.

<a id="dev-note"></a>
## Dev Note

None.

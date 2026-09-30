---
description: "Meteorology conversation cards for the dsh web client: the meteo_consult step trace with its findings and citations, the station-lookup candidate list, and the session-focus write."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-meteo-chat

English | [中文](README.zh.md)

## Summary

The conversation half of the meteorology surface: three `tool.call.toolview` cards — the consultation's six-step trace with its findings and retrieved chunks, the station-lookup candidate list, and the session-focus write. Each is a pure function of the frozen call slice, falling back to the generic input/output body whenever the metadata is missing or foreign.

## Table of Contents

- [What it registers](#what-it-registers)
- [The three cards](#the-three-cards)
- [Where the metadata comes from](#where-the-metadata-comes-from)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

One keyed `tool.call.toolview` entry per meteo tool — `meteo_consult`, `meteo_station_lookup`, `meteo_set_focus` — each under the tool name the turn log dispatches on, plus this package's `meteoChat` dictionaries. The plugin injects nothing but the seat and the namespace's copy: a card reads the call it is handed, never a service, so composing this row out of `cordis.yml` leaves every meteo call rendering as the generic Tool row.

`src/client/`: `meteo-meta.ts` (client-side copies of the tools' `presentationMeta` and the total narrowing), `meteo-card-model.ts` (the derivation), `meteo-chrome.tsx` (the shared disclosure row), `MeteoConsultCard.tsx` / `MeteoLookupCard.tsx` / `MeteoFocusCard.tsx`, `locales.ts`, and `index.ts`.

<a id="the-three-cards"></a>
## The three cards

All three share one 24px disclosure row: a lifecycle glyph on the left, the tool's title, a separator, and a one-line summary that changes with the call's state. A running call shows an ongoing dot; a failed call shows the first line of its failure; an interrupted call shows a warning dot. The summary is the question the model asked (`meteo_consult`), the candidate count (`meteo_station_lookup`), or the focus the call named (`meteo_set_focus`).

| Card | Collapsed | Expanded |
|---|---|---|
| `meteo_consult` | The question, or the failure's first line | The six pipeline steps in order, each with its outcome and one-line account; then either the clarification question with its candidate stations, or the resolved station, the observation and forecast rows, the per-day suitability judgements with the criteria that fired, the hazard grade with its basis, and the retrieved chunks last. |
| `meteo_station_lookup` | The candidate count, or that nothing matched | One row per candidate: identity, division, and coordinates. |
| `meteo_set_focus` | The station and crop the call named, or that the focus was released | The call's own arguments and result, through the generic body. |

Wire values the dictionaries know are localized and anything foreign renders verbatim, so a log written by a newer deployment still draws. A step outcome, a suitability verdict, and a clarification reason each have their own vocabulary; an unrecognized word is shown as itself rather than guessed at.

<a id="where-the-metadata-comes-from"></a>
## Where the metadata comes from

Every card derives from the frozen `ToolCallBlock` the slot hands it: the lifecycle from `kind`/`isError`/`error.code`, the arguments from the call head's raw JSON, and the findings from `meta`. The shapes in `meteo-meta.ts` are **re-declared client-side, not imported**: `dsh-tool-meteo` is a host package whose source must not enter the browser module graph, so the card reads the host's projection through its own total narrowing instead. Metadata from any source — an older log, a truncated window, a foreign producer — either yields the fields a renderer may read without a guard or narrows to `null`, and a `null` sends the card to the generic input/output body. Nothing is ever parsed out of the model-facing text.

`meteo_set_focus` publishes no `presentationMeta` at all, so its card reads the logged call arguments, which are the authoritative record of what the session committed to. A call head the log no longer carries is reported as such rather than shown as an empty focus: "the session named nothing" and "this frame cannot say" are different facts.

<a id="model-experience"></a>
## Model Experience

None, as this package draws conversation cards in the browser and registers nothing model-facing.

#### KV Cache effect

None; the cards read tool calls the session log already carries and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Presentation only.** The cards change no tool schema, prompt section, or result, and the metadata they read is incidental to the tool's contract: a deployment that drops the projection in a future version leaves these cards on the generic body rather than failing.
- **Citations are shown, not opened.** A consultation's retrieved chunks render with their ordinal, heading trail, and excerpt, but their rows do not yet open the `meteo-citation` viewer in the right Sidebar; that wiring is deferred with `ui-meteo`'s citation type.
- **No collapse memory.** Expansion state is per mount; reopening a session starts every row collapsed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The three cards were kept as separate modules rather than one parameterized card because their expanded bodies share no structure: the consultation body renders six sections from a nested record, while the other two render a list and a generic body respectively. Only the disclosure row is shared (`meteo-chrome.tsx`), which is why that module exists.

</details>

**Runtime invariant:** No companion is published. Every card is a pure function of the call block it is handed, and expansion is component state; neither observes another plugin's state in a way that could diverge.

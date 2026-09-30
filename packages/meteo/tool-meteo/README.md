---
description: "Model-facing consultation tools over the meteorological data and corpus seams: what meteo_consult, meteo_station_lookup and meteo_set_focus let an agent answer, and how to configure their bounds."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-meteo

English | [中文](README.zh.md)

## Summary

The consultation tools give the model the evidence a township-level farming or disaster answer needs. `meteo_consult` resolves the place and crop it was told — or that the session already holds — reads that station's observations and forecast, grades each day's suitability and one disaster level against the deployment's own thresholds, and retrieves the indexed corpus chunks that bear on the question. It returns findings and a step trace, never an answer: the model composes the answer and cites the chunks. Choose it when answers must be reproducible and citable; the deployment owns the data and the thresholds.

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

Mount the package as a plugin row once `ctx.meteoData` and `ctx.corpus` are provided; it registers its three tools and one prompt section.

### When to choose it

Choose it when an agent must answer about a specific place from a specific deployment's data and the reader may need to check the answer. Skip it when the question is general enough that a textbook answer is what is wanted — the tools exist to keep a local claim tied to local evidence, and they cost a station resolution, two series reads, a rule pass, and a corpus query per consultation.

### Minimal configuration

```yaml
- id: tool-meteo
  name: '@deepseek-ai/dsh-tool-meteo'
  config:
    defaultLimit: 6
    forecastHours: 72
```

| Field | Default | Meaning |
|---|---|---|
| `defaultLimit` | `6` | Corpus chunks one `meteo_consult` retrieves when the model omits `limit`. |
| `maxLimit` | `20` | Largest `limit` accepted; a larger request is rejected rather than clamped. |
| `forecastHours` | `72` | Forecast horizon in whole hours the consultation reads. |
| `maxClarificationCandidates` | `6` | Candidate stations one clarification result names. |
| `maxSnippetChars` | `280` | Citation excerpt cap, in code points. |
| `maxSeriesRows` | `24` | Observation and forecast rows each listed in the model-facing text. |
| `timeoutMs` | `30000` | Cooperative tool-call budget attached to all three tools. |

Every bound is validated at load: a non-positive or fractional value, or a `defaultLimit` above `maxLimit`, fails the plugin rather than the first consultation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`meteo_consult` executes in a fixed order and appends one entry per step to the trace it returns: slots, observation, forecast, suitability, hazard, corpus. Every step is a call into `ctx.meteoData` or `ctx.corpus`; the tool itself performs no I/O and holds no data.

The station slot resolves against the deployment's published stations — an exact identifier, then an exact name, then a unique partial match — and falls back to the session focus before it gives up. An unresolved station returns a clarification carrying the candidates and **runs no further step**, which is why a clarification costs nothing and cannot fabricate a verdict for the wrong place.

`rules.ts` is the judgement: pure and total functions taking threshold and sample records and returning `suitable` / `unsuitable` / `unknown` per day plus the criteria that fired, with the hour span each criterion held. A criterion whose `durationH` the readings never reach does not fire; a hazard with no matching threshold reports `unknown` rather than a level. The engine reads the deployment's `thresholds` and `cropCalendar` records and never a number of its own.

`presentation.ts` builds the model-facing text and the result metadata. The metadata carries the step trace, the per-step findings, the citation list, and the rule version, so a client renders sub-cards and citation chips without re-deriving anything, and a later answer stays reconcilable with the thresholds that produced it.

`apply` registers the three tools and one prompt section whose text renders empty whenever `ctx.tools.get('meteo_consult', scope)` is undefined, so a composition that hides the tool contributes no guidance about it.

**Runtime invariant:** No companion is published. The rule engine is a pure function over records the seams own, the tools hold no durable relation of their own, and what one consultation produced is reconstructed from its result metadata and the session log rather than from a package-local event stream.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Meteorology consultation](../../../docs/subsystems/meteo.md) — the data and corpus seams these tools consume.
- [`dsh-tool-corpus`](../tool-corpus/README.md) — the sibling Consumer for indexing and retrieval, which this package calls through `ctx.corpus` rather than by registering tools of its own.
- [`dsh-meteo-data`](../meteo-data/README.md) — the station, threshold, and focus contracts every step here reads.

## Model Experience

### Consultation evidence

#### What the model sees

Three tool schemas plus one prompt section (`tool:meteo`). The section states the order to work in — consult before answering a farming or disaster question, pass every slot understood, cite the chunk a conclusion draws on, and ask the farmer which station is meant when a clarification comes back — and it renders as empty text whenever `meteo_consult` is not visible in that scope. `meteo_consult`'s result is the model-facing render of its findings: the resolved station, the listed observation and forecast rows, per-day verdicts with their fired criteria, one hazard level with its basis, and the citation excerpts.

#### Token effect

Every consult spends a fixed shape: one tool call and one result carrying up to `maxSeriesRows` observation rows, `maxSeriesRows` forecast rows, the suitability days, the hazard, and up to `defaultLimit` citation excerpts capped at `maxSnippetChars`. The prompt section is one short block, so a composition that hides the tool removes it from both the schema list and the prompt.

#### KV Cache effect

No direct invalidation. The section joins the assembled prompt at its allocated order and the tool schemas join the request the same way every other tool's do; a consumer that adds retrieved chunks to the conversation owns the resulting prompt-prefix behavior.

## Known Limitations and Deferred Work

- The rule engine grades only what `ctx.meteoData` publishes. A crop window with no criteria, or a criterion element the station never measures, yields `unknown` rather than a guess.
- Suitability is graded per calendar day from the series the seam returns; it does not interpolate between readings.
- One hazard level per consultation. Ranking several disasters against one another is the caller's composition, not a tool feature.
- The tools take the session focus as the only source of an omitted slot; there is no per-user or per-place default beyond it.
- Corpus retrieval is lexical. The tool passes the caller's terms through to `ctx.corpus` and does not rerank or expand beyond what `ctx.meteoData.expandTerm` returns.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

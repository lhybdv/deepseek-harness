---
description: "Meteorological data capability for the harness consultation: what the ctx.meteoData seam offers, how its two transports read one published bundle, and how a session carries its focus across turns."
kind: "package-reference"
---

# @deepseek-ai/dsh-meteo-data

English | [中文](README.zh.md)

## Summary

`dsh-meteo-data` is one seam over the numbers a meteorological consultation answers from: station catalogues, hourly observations, forecast points, warning criteria, sowing windows, and term expansions. Two providers ship with it — a bundle read out of a directory, and the same bundle read from a static HTTP origin — so a real feed is a provider behind the same name. It also carries the consultation's focus, the station and crop a session is working on, as a `meteo/focus` session event folded into a `meteoFocus` projection: the third turn never restates the second.

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

Mount the package as a plugin row and it registers as `ctx.meteoData`. Loading it also registers the `meteoFocus` session projection, so a focus written in one turn is readable in the next.

### When to choose it

Choose it when a consultation answers about a place and a crop from published numbers, and those numbers may come from a directory today and from a feed tomorrow. Reach for [`dsh-meteo-corpus`](../meteo-corpus/README.md) instead when the question needs professional text that an answer must cite; the two seams answer different questions. Extend `MeteoData` directly when the upstream is a query API rather than a published bundle: filtering and the focus live in the seam, not in the transport.

### Minimal configuration

```yaml
- id: meteo-data
  name: '@deepseek-ai/dsh-meteo-data'
  config:
    source: fixture
    fixtureDir: !!js `${process.env.DSH_HOME}/meteo/bundle`
```

| Field | Default | Meaning |
|---|---|---|
| `source` | `fixture` | Transport: `fixture` reads a directory, `http` reads an origin. |
| `fixtureDir` | required with `fixture`, refused by `http` | Directory holding the bundle. |
| `baseUrl` | required with `http`, refused by `fixture` | Origin root the bundle is published under; a trailing slash is refused. |
| `timeoutMs` | `15000` | Deadline applied to every single HTTP request. |

### The bundle

Both transports read one layout, so a bundle is exported once and served either way:

```text
stations.json
observations/<stationId>.json
forecast/<stationId>.json
thresholds.json
crop-calendar.json
synonyms.json
taxonomy.json
meta.json
```

`thresholds.json` and `crop-calendar.json` carry the warning criteria a grower is graded against and the windows those criteria apply in; `synonyms.json` and `taxonomy.json` are what turn a colloquial `倒春寒` into the hazard name the criteria are filed under; `meta.json` publishes the revision of every dataset so an answer can say how old its numbers are.

### Carrying the focus across turns

```ts
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { appendFocus, readFocus } from '@deepseek-ai/dsh-meteo-data'
import type { Session } from '@deepseek-ai/dsh-session'

declare const ctx: Context
declare const session: Session
declare const agent: Agent

appendFocus(session, { stationId: 'ha-xx-01', crop: '冬小麦', updatedAt: Date.now() })
const focus = readFocus(ctx, agent)
```

A write replaces the whole snapshot, so a turn that only changes the crop still names the station it means; `appendFocus(session, null)` releases the focus.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Transports, published shapes, and where each answer is computed.</summary>

Two transports implement one internal `MeteoSource` interface — `load(kind)`, `expandTerm(term)`, `versions()` — and each caches the raw JSON it has read, once per process. `FixtureMeteoSource` lists and reads a directory; `HttpMeteoSource` fetches the same names under `baseUrl` with `Accept: application/json` and an `AbortSignal.timeout(timeoutMs)` deadline. The `LocalMeteoData` class above them owns every answer: which rows a query keeps, how a horizon is measured, and what a bad query means.

The per-station datasets (`observations`, `forecast`) are one file per station. The first read of either fans out over the station catalogue and reads that dataset's whole directory or origin once, then serves every later station from that single snapshot; an origin that carries no file for a station is answered with an empty series rather than an error, because a gap in coverage is a fact about the bundle.

Every file is validated against a zod schema on read. A bundle that does not match its published shape is refused with `METEO_DATASET_UNAVAILABLE` and a message naming the dataset, rather than being served half-parsed. The seam's own failures are `MeteoDataError` with a code a caller can branch on: `METEO_STATION_NOT_FOUND` for a station an observation or forecast query names but the catalogue does not carry, `METEO_INVALID_QUERY` for a `from`, `to`, or `hours` that is not a usable instant or horizon, and `METEO_SOURCE_ERROR` when an origin cannot be reached, answers a non-success status, sends a body that is not JSON, or outlives the deadline.

Filtering is deliberately small and total. `stations` matches `county` exactly and `text` as a substring of the name, the township, or the county, so a caller can pass whatever the user said. `observations` keeps an inclusive window on both ends. `forecast` measures `hours` from `from` when the query gives one and otherwise from the earliest published point, which is what makes a one-hour horizon mean the same thing before and after the first point is dropped. `thresholds` filters by hazard and keeps the rows issued for the asked crop, in published order, and `cropCalendar` filters windows by the hazards their own criteria name.

`meteoFocus` is a session projection with state `FocusSnapshot | null`: `init` is `null`, and `apply` replaces the state wholesale on a `meteo/focus` event and leaves it untouched on every other session event. The answer therefore always comes from folding the session log, never from provider memory, which is why two consultations in one process never see each other's focus.

**Runtime invariant:** No companion is published. The seam reads a published bundle and folds one session projection the projection registry already validates; it owns no second copy of a dataset and no mutable relation outside the `meteo/focus` event.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-meteo-corpus`](../meteo-corpus/README.md) — the sibling seam that answers from professional text and carries the citation an answer needs.
- [`dsh-session-projection`](../../session/session-projection/README.md) — the registry `meteoFocus` folds through, and where projection state is stored and versioned.
- [Capability seams](../../../docs/capability-seams.md) — where a Service Definition sits among its provider and consumer.

<a id="model-experience"></a>
## Model Experience

### The session focus

#### What the model sees

Nothing reaches the model from this package directly: it registers no tool and contributes no prompt text. What the model sees is what a consuming meteorology tool returns — station rows, observation and forecast series, the criteria a hazard is graded against, and, once a tool has written one, the focus echoed back as the place and crop the consultation is treating as given. Dataset revisions from `versions()` are what let an answer state how old its numbers are without the model guessing.

#### Token effect

The focus snapshot is three optional fields and costs a tool result only when a tool chooses to echo it, so carrying state across turns replaces the cost of the user restating it and of the model re-resolving it from earlier turns. Series length is the real cost and is bounded by the query: `from` and `to` on observations, `hours` on a forecast, both of which the calling tool decides.

#### KV Cache effect

No direct invalidation. A `meteo/focus` event extends the session log, and the projection state it produces is read only when a tool asks, so nothing here rewrites a prompt prefix on its own; the consumer that decides whether to name the focus in a tool result owns the resulting cache behavior.

## Known Limitations and Deferred Work

- Bundles are not shipped inside the package: `files` publishes code only, so `fixtureDir` is required configuration and each deployment points the seam at its own bundle.
- A per-station read loads that dataset's whole directory or origin once per process. A bundle with many stations pays for stations nobody asks about on the first read.
- The raw JSON snapshot is never invalidated. A bundle that changes on disk or at the origin is picked up by a restart, not by a later read.
- The demo bundle's forecast carries no soil moisture, so a forecast answer never reports that element while an observation answer does.
- The focus is one whole-value snapshot with no merge, no expiry, and no history. Releasing a stale focus is a `null` write, and deciding when to write it belongs to the consultation.
- Queries are exact-equality and substring only: no radius or bounding-box station search, no unit conversion, no quality control or gap filling of the numbers themselves.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

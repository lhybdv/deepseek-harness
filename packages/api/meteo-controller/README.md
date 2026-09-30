---
description: "Host Remote owner of the meteorology consultation surface: what ctx.remote.meteo exposes over the corpus and data seams, and why the panel and the model end up reading the same index."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-meteo-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-meteo-controller` puts the M1 meteorology demo's browser seam on the wire as the Remote namespace `meteo`: corpus listing, search, chunk reopening, removal, station lookup, and the session's focus, reached through `ctx.remote.meteo.*`. It decides nothing about weather and stores nothing. Every call lands on the two seams that already answer the model, so a citation the user opens is the citation the model quoted. The package takes no configuration. Its limits are per-request quotas, not ceilings on corpus or dataset size; the deployment that owns the index and the station dataset owns those scales.

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

Mount it beside the two seams it fronts, and the `meteo` namespace registers; a browser calls it as `ctx.remote.meteo.*` through the Client assembly `@deepseek-ai/dsh-api-remotes`, which is the only package that imports this one's generated Remote contribution.

### When to choose it

Choose it when a browser UI must show or change what the `dsh-meteo-data` and `dsh-meteo-corpus` seams already answer for the model — the corpus panel, the citation reader, the station picker, the focus chip — and the deployment wants one index behind both planes. Do not extend it for data it does not own: a UI that needs a capability its seams lack gets a namespace of its own over that owner rather than a widened `meteo`, because every method here is exactly one seam call and the package holds no policy beyond the demo. It is read-mostly plus one corpus write, and it never starts a session submission over the Remote: a UI that must run the conversation submits a message through `dsh-api-session-controller` and lets the model call `meteo_consult`.

### Minimal configuration

The package takes no configuration and registers nothing beyond its one service: a plugin row, plus the seams it requires.

```yaml
plugins:
  - '@deepseek-ai/dsh-api-meteo-controller'
```

| Field | Default | Meaning |
|---|---|---|
| none | none | No configuration fields; per-request bounds are constants in the source file. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` is one class: `MeteoController extends TypertRemoteService`, `static inject = ['corpus', 'meteoData', 'sessionProjections', 'typert']`, and a constructor that calls `super(ctx, 'meteoController', { namespace: 'meteo' })`. Seven `@Remote` methods, each exactly one call on a seam.

What the wire format cannot say about a method signature is stated by one zod expression at the top of the body. The generated wire codec checks the *shape* of JSON data: strings, integers, optionality. The constraints declared here are more specific — a non-empty document id and label, a non-negative `ordinal`, a positive `limit`, a batch of between one and `MAX_INGEST_SOURCES` sources, a station lookup with at least one filter. A rejected payload throws `gateway/bad-request` carrying zod's issue list. The `stationLookup` guard is worth reading on its own: an unfiltered station query enumerates the whole dataset, and its shape is perfectly legal JSON, so only a domain rule can refuse it. `corpusSearch` deliberately states no limit ceiling — the store clamps an explicit limit to its own configured maximum, and a second ceiling there would silently contradict that configuration.

Two seam types are reused as the wire types: `CorpusDocument`, `IngestSource`, `IngestResult`, `CorpusChunk`, `RemoveResult` from the corpus seam, `Station` and `FocusSnapshot` from the data seam. Only `MeteoSearchHit` is local, because the index's `CorpusHit` carries the whole chunk body and the panel wants an excerpt; `hitView` drops the `text`, flattens whitespace, and caps at `MAX_EXCERPT_CHARS` so a hit is a row rather than a paragraph. The method that reads the body is `corpusRead`, which reopens the chunk and returns it verbatim.

Seam silence would be the wrong answer in a browser, so the package gives it a name. `readChunk` returns `undefined` for a missing chunk; `corpusRead` throws `meteo/chunk-not-found` with that address. `stations()` throws a `MeteoDataError`; `stationLookup` carries its code into `meteo/data-unavailable` as the details `reason` and leaves the error on `cause`. Everything else rethrows untouched: the controller does not guess at a seam's intent. `corpusRemove` hands the `RemoveResult` back *including* `removed: false` — a document that was already gone is the state of the world the panel wanted, not a failure. Both codes are declared into the protocol's `RemoteErrorDetailsMap` in `src/types.ts`, so a typed `ctx.remote.meteo.*` caller can `catch` and discriminate them, while `gateway/bad-request` reuses the one the Gateway already owns.

`focusGet` demonstrates the boundary. `readFocus(ctx, agent)` reads the projection by *session*, and the browser can only put an id on the wire, so the generated glue resolves the `agent` parameter from the wire `SessionId` (the declared signature carries `session`) and any extra `agent` argument the panel sends is discarded by the generated code. A focus cannot be forged through this package.

**Runtime invariant:** No companion is published. The namespace projects the two seams and stores nothing of its own; a method's outcome is the seam's own state, and the Client rebuilds it by re-reading the panel's lists and the session focus.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-meteo-corpus`](../../meteo/meteo-corpus/README.md) — the retrieval seam the five corpus methods ask.
- [`dsh-meteo-data`](../../meteo/meteo-data/README.md) — the data seam that owns the station dataset and the session focus projection.
- [`dsh-tool-corpus`](../../meteo/tool-corpus/README.md) — the tools that read the same index and hand citations back to the model.
- [Adding a Remote API](../../../docs/cookbook/adding-a-remote-api.md) — the generated Remote contract this package follows, including the parameter-name guard.
- [`@deepseek-ai/dsh-api-remotes`](../remotes/README.md) — the browser assembly that mounts generated Remote contributions as `ctx.remote`.

-----

## Model Experience

### Corpus and station reads

#### What the model sees

Nothing. `ctx.remote.meteo.*` is a browser surface; the model reaches the same data through the meteorology tools' results, and those results carry the citation fields, not the Remote envelope.

#### Token effect

Zero: these calls never enter a prompt, and `MAX_EXCERPT_CHARS` bounds a panel row, not a tool result.

#### KV Cache effect

None — no request prefix is created or mutated. A panel that renders a hit into a visible composer produces a prompt only when the user submits it, through the Session Controller's namespace.

## Known Limitations and Deferred Work

- The package exposes what the two seams already do. Chunked byte upload for corpus text, streaming results, and station-dataset staleness by data version are all deferred; none of them belong to a controller that stores nothing.
- Focus is read-only here even though `meteo-focus` writes it. A user-set focus that the model should see, and that must survive the model's own writes, needs a session-scoped store both planes can write and one projection both can read — the M1 panel only mirrors what the model wrote.
- No `meteo/*` event: the panel refetches focus after a submission rather than being pushed. A pushed focus needs `meteoFocus` allowlisted as a forwarded event in `@deepseek-ai/dsh-api-remotes`.
- `corpusIngest` carries whole document text in one Remote request, bounded by `MAX_INGEST_SOURCES`. A paste-sized guide fits; a scanned PDF does not, and the upload path for those is not here.
- Authorization is the host's assumption: every call is allowed for whoever can reach the Remote of a session. M1's demo host is single-user, so the seam between the wire-resolved `SessionId` and an authenticated user is deferred rather than faked.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

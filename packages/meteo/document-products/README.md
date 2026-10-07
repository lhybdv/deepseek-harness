# Meteorological document products
English | [中文](README.zh.md)

This package provides one typed `DocumentProduct` model for disaster-warning products and agricultural meteorological service briefs. `generateProduct` reads observations, forecasts, disaster thresholds, crop-calendar windows, and cited corpus chunks through the shared `MeteoData` and `CorpusStore` seams. A composer may refine prose, but verification rejects numeric claims absent from the populated provenance and preserves citations and section headings.

Load the host plugin after `meteo-data` and `meteo-corpus`:

```yaml
- id: meteo-document-products
  name: '@deepseek-ai/dsh-document-products'
  config:
    forecastHours: 72
    citationLimit: 5
    timeoutMs: 30000
    snippetChars: 200
    documentChars: 8000
    artifactDir: outputs/meteo-document-products
```

The Cordis service is available as `ctx.documentProducts`. It keeps an in-process session projection of products/releases and records the complete product and transitions in the session event log, which is the replayable storage source. `hazardResolved(session, grading)` is called by the resolved hazard grader to create a warning product, while `generate(session, explicitInput)` supports manual requests.
`hazardResolved(session, grading)` is idempotent within a session for the same station, hazard, grade, and period: repeated calls return the same product, including while the first call is still in flight. A failed generation removes its deduplication entry and writes neither a partial product nor a creation event; the error propagates, and the manual `generate(session, explicitInput)` path remains available.

`transitionProduct` implements actor-attributed draft editing, review, approval, rejection, publication, and archive transitions. `meteo_document` action `edit` accepts a product id, replacement `body`, and actor while the product is a draft; it replaces the 正文 body only. Section headings and the citation list are composed by the service and remain unchanged. Post-edit verification requires (a) a non-empty body and (b) every number in it to be grounded in the filled data; citation coordinates are checked by the same verifier. A failed edit does not change the retained product, and an accepted body is recorded in the session event with its actor and instant. Publishing creates a frozen, incremented release artifact from the current edited body.

The prose composer is an injected adapter: pass a real model-backed function for model wording or omit it to use the deterministic template. No numeric value is accepted from the composer without re-verification.

The package also registers the model-facing `meteo_document` tool, so the 编–审–发–存 loop is visible in the conversation: every result includes the title, ordered sections, body, and cited source coordinates, capped by `documentChars` with an explicit truncation marker. `list` identifies products by title and state; `edit` replaces only the body in draft and reports the actor/instant and resulting version state while preserving service-composed section headings and citations. Publishing writes an immutable, versioned Markdown file under `artifactDir` and reports its absolute path; republishing writes a new version without replacing earlier files. Every operation remains scoped to the calling agent’s session.

`timeoutMs` and `snippetChars` bound the tool's cooperative call budget and citation excerpts; `documentChars` caps rendered product text, and `artifactDir` selects the Markdown release directory. The plugin's `inject` names `tools` alongside the data seams, because registering a tool needs the tool registry.

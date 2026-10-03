# Meteorological document products

This package provides one typed `DocumentProduct` model for disaster-warning products and agricultural meteorological service briefs. `generateProduct` reads observations, forecasts, disaster thresholds, crop-calendar windows, and cited corpus chunks through the shared `MeteoData` and `CorpusStore` seams. A composer may refine prose, but verification rejects numeric claims absent from the populated provenance and preserves citations and section headings.

Load the host plugin after `meteo-data` and `meteo-corpus`:

```yaml
- id: meteo-document-products
  name: '@deepseek-ai/dsh-document-products'
  config:
    forecastHours: 72
    citationLimit: 5
```

The Cordis service is available as `ctx.documentProducts`. It keeps an in-process session projection of products/releases and records the complete product and transitions in the session event log, which is the replayable storage source. `hazardResolved(session, grading)` is called by the resolved hazard grader to create a warning product, while `generate(session, explicitInput)` supports manual requests.
`hazardResolved(session, grading)` is idempotent within a session for the same station, hazard, grade, and period: repeated calls return the same product, including while the first call is still in flight. A failed generation removes its deduplication entry and writes neither a partial product nor a creation event; the error propagates, and the manual `generate(session, explicitInput)` path remains available.

`transitionProduct` implements actor-attributed draft, review, approval, rejection, publication, and archive transitions. Publishing creates a frozen, incremented release artifact. `transitionInSession` writes every transition into the session log for replay; each release is included in its publication event.

The prose composer is an injected adapter: pass a real model-backed function for model wording or omit it to use the deterministic template. No numeric value is accepted from the composer without re-verification.

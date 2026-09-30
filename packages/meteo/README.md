---
description: "The meteo group map: the corpus retrieval seam, the meteorological data seam, and the model-facing tools that answer township-level disaster and farming questions, for users and maintainers navigating the group."
kind: "package-group"
---

# meteo/ — Meteorological consultation

English | [中文](README.zh.md)

## Summary

The meteo group turns a deployment's own meteorological data and professional corpus into township-level answers: what the observations and forecast say, whether a farming activity is suitable, what disaster risk a period carries, and which sources support the conclusion. Each capability is a seam whose provider ships beside it, so replacing a data source or a corpus backend is a configuration change that leaves the tools and the model request untouched. Treat this as a deployment-domain family rather than a product spine: the seams are stable, the fixtures that demonstrate them belong to the deployment.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`meteo-corpus/`](meteo-corpus/README.md) | Corpus retrieval seam plus its SQLite FTS5 provider, indexed by CJK bigrams | `ctx.corpus` |
| [`tool-corpus/`](tool-corpus/README.md) | Model-facing tools `corpus_ingest`, `corpus_search`, and `corpus_read` over `ctx.corpus` | — |
| [`meteo-data/`](meteo-data/README.md) | Meteorological data seam over one published bundle, plus the cross-turn `meteoFocus` session projection | `ctx.meteoData` |
| [`tool-meteo/`](tool-meteo/README.md) | Model-facing consultation tools `meteo_consult`, `meteo_station_lookup`, and `meteo_set_focus`, with the deterministic suitability and hazard rule engine | — |
| [`../api/meteo-controller/`](../api/meteo-controller/README.md) | Host Remote owner of the `meteo` namespace: the corpus panel's reads and writes and the session focus, over both seams | `ctx.meteoController` |

The UI packages that present this group's results arrive with their own packages. A capability enters this group as a Service Definition with the provider or consumer that makes it usable, never as one role alone.

-----

<a id="related-documentation"></a>
## Related documentation

- [Meteorology consultation](../../docs/subsystems/meteo.md) — the data and corpus seams this group owns.
- [Architecture](../../docs/architecture.md) — the extension-point map these packages attach to.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Provider / Consumer roles.

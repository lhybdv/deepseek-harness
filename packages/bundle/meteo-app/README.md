---
description: "The meteorology consultation bundle: which seams, tools, and Remote surfaces a deployment enables by stacking it, and what it expects the deployment to publish."
kind: "package-bundle"
---

# @deepseek-ai/dsh-meteo-app

English | [中文](README.zh.md)

## Summary

Stacking this bundle gives a deployment the meteorological consultation surface: a data seam that reads the deployment's own published bundle, a corpus seam that indexes uploaded documents into one SQLite file, the model-facing tools that answer township-level farming and disaster questions from those two seams, and the Remote namespace the browser panels call. It adds no behaviour of its own — every row is configuration — and it expects the deployment to publish a data bundle and to supply the professional corpus it wants answers grounded in.

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

Add the package to a profile's bundle list, or stack it with `--patch`.

### When to choose it

Choose it when the answers an agent gives must come from a specific deployment's stations, thresholds, and professional text rather than from general knowledge. It is not a general weather capability: without a published data bundle the seam answers nothing, and without an ingested corpus the tools answer without citations.

### Minimal configuration

A profile lists it after the base and web-application bundles:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-meteo-app"
      ]
    }
  }
}
```

The rows it inserts carry deployment-varying values, and a later layer overrides any of them by id:

| Row | Field | Deployment supplies |
|---|---|---|
| `meteo-corpus` | `path` | The index file. Defaults under the Harness home; give it a dedicated file. |
| `meteo-corpus` | limits | Retrieval window, chunk size, and accepted document size. |
| `meteo-data` | `source` | `fixture` reads a directory; `http` reads an origin root. |
| `meteo-data` | `fixtureDir` / `baseUrl` | Where that deployment's bundle is published. |
| `tool-meteo` | limits | Retrieval window, forecast horizon, clarification breadth, and timeout. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A bundle is a distribution format for Cordis config rows and the code they mount, never a behaviour of its own: `package.json` declares `dsh.bundle.patch`, and the Loader applies `cordis.patch.yml` in the order the profile lists its bundles. This bundle's only source file is an empty `apply`, which exists so the package has the same shape as every other bundle.

The rows are ordered so a consumer activates after what it needs. `meteo-corpus` and `meteo-data` provide the two services; `tool-corpus` and `tool-meteo` register tools that wait on them; `meteo-controller` provides the Remote namespace the browser calls. Cordis service injection sequences that on its own, so an operator reordering these rows changes nothing.

Both seams are deliberately configuration-driven rather than code-driven. A deployment that publishes its bundle over HTTP switches `meteo-data.source` from `fixture` to `http` and sets `baseUrl`; a deployment that wants several corpora runs several index files. Nothing above either seam changes, which is the property that lets the same tools and the same panels serve a different region.

**Runtime invariant:** No companion is published. A bundle contributes configuration, the rows it names own every relationship, and the Loader's own entry tree is the observable state.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Meteorology consultation](../../../docs/subsystems/meteo.md) — the seams this bundle mounts.
- [Meteo driver group](../../meteo/README.md) — the packages the rows name.
- [Profiles and bundles](../../../docs/architecture.md) — how a profile stacks bundles and overrides their rows.

## Model Experience

### Consultation surface

#### What the model sees

Whatever the rows it mounts contribute: `tool-meteo`'s three tool schemas and its `tool:meteo` prompt section, and `tool-corpus`'s three corpus schemas and its own section. This package adds no schema, no section, and no tool of its own, so hiding either tool removes exactly that tool's surface.

#### Token effect

None directly. Every row's cost belongs to the package that owns it; a deployment that mounts this bundle pays for the tools it names and for nothing else.

#### KV Cache effect

No direct invalidation. The bundle only decides which rows exist, and the rows themselves own their prompt-prefix behavior.

## Known Limitations and Deferred Work

- The bundle expects a published data bundle. It ships none, so a deployment that stacks it without one gets a seam that answers with an unavailable dataset rather than an error at load.
- One corpus index is one file. Several corpora, or several processes sharing one, are outside this bundle's composition.
- The `http` data source reads the same shapes the `fixture` source does; a business API that speaks a different vocabulary needs its own provider rather than a new `baseUrl`.
- The demonstration fixtures stay in the repository and are not published with their package, which is why the example overlay, not the bundle, points `fixtureDir` at them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

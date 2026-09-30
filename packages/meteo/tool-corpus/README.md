---
description: "The model-facing corpus tools (corpus_ingest, corpus_search, corpus_read) over ctx.corpus: how deployments mount, configure, and observe the retrieval tools the model sees."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-corpus

English | [中文](README.zh.md)

## Summary

`dsh-tool-corpus` gives a model three tools over the corpus seam that `@deepseek-ai/dsh-meteo-corpus` mounts: `corpus_ingest` indexes documents the deployment supplies, `corpus_search` retrieves ranked chunks, and `corpus_read` reopens one chunk verbatim. Every result carries the document title, chunk ordinal, and character range a conclusion must cite, so an answer can name the indexed passage behind it — and say that nothing indexed covers the question instead of inventing a source. Retrieval depth, snippet size, and indexing budgets are deployment configuration rather than model arguments.

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

Load the package in a composition that already mounts a corpus provider; it registers `corpus_ingest`, `corpus_search`, and `corpus_read` and adds their guidance to the system prompt.

### When to choose it

Choose this package when answers must be traceable to documents the deployment owns — a crop-loss rule, a spraying window, a disaster playbook — rather than to model memory. The three tools are registered together: retrieval without indexing leaves the index empty, and indexing without retrieval leaves the model no way to consult it. Hide individual tools per agent with the tool registry's scoped restrictions; guidance then disappears with the hidden tool.

### Minimal configuration

Load the corpus provider and this package. The provider is a `CorpusStore` plugin such as the SQLite FTS5 backend; the tools take no path or database argument.

```yaml
- name: '@deepseek-ai/dsh-meteo-corpus'
- name: '@deepseek-ai/dsh-tool-corpus'
```

| Field | Default | Meaning |
|---|---|---|
| `defaultLimit` | `8` | Chunks one `corpus_search` call returns when the model asks for no limit |
| `maxLimit` | `20` | Largest `limit` a `corpus_search` call accepts; larger values are rejected |
| `maxSnippetChars` | `280` | Cap on the snippet a search citation carries to the client |
| `maxIngestDocuments` | `10` | Largest `documents` array one `corpus_ingest` call accepts |
| `maxIngestChars` | `200000` | Largest total characters one `corpus_ingest` call accepts |
| `timeoutMs` | `30000` | Cooperative tool-call timeout budget (ms) attached to all three tools |

The [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for every accepted field and its JSDoc. Bounds are checked before any provider call, so a rejected call indexes or retrieves nothing; a value that is not a positive integer, or a `defaultLimit` above `maxLimit`, fails at load.

### Using corpus_search

`corpus_search` takes a required `query` plus optional `terms` and `limit`, and unions the query's own tokens with the extra terms so a caller can add the vocabulary the question implies. Each hit is a chunk with a document title, ordinal, heading trail, and character range, and the result text instructs the model to cite all three. An empty result says so and names the two productive next steps.

```text
Matched 1 chunks (most relevant first).

[1] 病虫害防治气象指标 | docId doc-1 | chunk 0 | chars 12-240 | heading 施药适宜气象条件
风速低于 3 米每秒
```

### Using corpus_ingest

`corpus_ingest` indexes the documents in the call, at most `maxIngestDocuments` of them and `maxIngestChars` characters in total. Each document needs a `title` and non-empty `text`; `source` records where the document came from. The provider decides what it can accept, so a refused document comes back as a titled failure code beside the accepted ones instead of failing the call.

### Using corpus_read

`corpus_read` takes a `docId` and an `ordinal` and returns that chunk verbatim, which is how a model verifies a citation before it commits to a number. A chunk the index no longer holds returns a message that names the missing pair and sends the model back to `corpus_search`.

### Failures and recovery

Argument rules the JSON schema cannot state — a blank `query`, an empty `terms` entry, a `limit` outside `1..maxLimit`, a negative `ordinal`, an oversized ingest batch — are rejected before the provider runs, and the registry renders the message back to the model, which can retry with valid arguments. A provider failure surfaces the same way.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

The package owns nothing but the model-facing surface: it converts model arguments into seam requests, converts results into text plus structured metadata, and states the rules the schema cannot express. Indexing, tokenization, ranking, and chunk layout belong to `ctx.corpus`, so replacing the SQLite provider changes no tool behavior the model can observe beyond the text the provider itself produces.

### Source map

| File | Role |
|---|---|
| `src/index.ts` | Plugin entry: config assertion, `tool:corpus` prompt section, three registrations |
| `src/config.ts` | `Config` schema, defaults, and `assertCorpusLimits` |
| `src/search.ts` | `corpus_search` registration, output schema, presenters |
| `src/ingest.ts` | `corpus_ingest` registration, output schema, presenters |
| `src/read.ts` | `corpus_read` registration, output schema, presenters |
| `src/presentation.ts` | Metadata narrowing and snippet capping shared by the three presenters |

### Retrieval flow

A search call validates `query`, `terms`, and `limit`, clamps nothing, and forwards the request; the provider's ranked hits become one text block and a `citations` array whose snippet is capped at `maxSnippetChars`. `truncated` records that the window was filled rather than that the corpus is exhausted, which is the weaker claim the provider can actually support. The BM25 score stays inside the provider: rank is array order, and a raw score invites the model to compare quantities that are not comparable across queries.

### Presentation

Each tool registers `presentCall` and `presentResult` so a client can rebuild a card from a logged transcript without re-running the call, and `output.presentationMeta` so the structured metadata is recorded at the moment of the call. Presenters validate their arguments and metadata shape and return `undefined` on a mismatch, which makes the generic fallback the outcome for replayed legacy arguments rather than an exception.

**Runtime invariant:** No companion is published. The tools are thin mappings from `ctx.corpus` to wire results and hold no durable relation of their own; what an ingest or a search produced is reconstructed from the tool result recorded in the session log.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [dsh-meteo-corpus](../meteo-corpus/README.md) — the corpus seam, its SQLite FTS5 provider, chunk layout, and error codes.
- [Meteo package map](../README.md) — the group's seams and consumers.
- [dsh-tools](../../core/tools/README.md) — the registry that validates arguments and enforces the timeout budget.
- [Generated tool catalog](../../../docs/tool-catalog.md) — the exact registered schemas.
- [Generated configuration catalog](../../../docs/config-catalog.md) — every accepted config field and its source declaration.
- [Adding a tool](../../../docs/cookbook/adding-a-tool.md) — the `defineTool` guide this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One `tool:corpus` section renders while `ctx.tools.get('corpus_search', scope)` resolves in the caller's scope, so a scope whose retrieval tool is hidden loses the guidance too. The text names the default and maximum retrieval window, the ingest budgets, and the citation duty, taken from the resolved configuration.

##### Corpus guidance with default configuration

```markdown
Use corpus_search when an answer must come from documents indexed by this deployment: pass the question as query and add the terms you derive from it (disaster type, crop, activity, weather element), because recall unions both. It returns 8 chunks by default and 20 at the most, ranked, each with a document title, a chunk ordinal, and a character range. A chunk is an excerpt: when an excerpt is not enough, call corpus_read with the docId and ordinal of that hit to reopen the whole chunk. Every conclusion drawn from a chunk must cite the document title, the chunk ordinal, and the character range. When nothing matches, say the indexed documents do not cover the question instead of inventing a citation. Index new documents with corpus_ingest, at most 10 documents and 200000 characters in total per call.
```

#### Token effect

One paragraph of roughly one hundred and twenty tokens per visible scope, growing only as `defaultLimit`, `maxLimit`, `maxIngestDocuments`, or `maxIngestChars` changes; a scope that hides `corpus_search` contributes nothing.

#### KV Cache effect

Prefix-stable while the section is visible and the four advertised bounds are unchanged. Changing a bound, or registering or disposing the plugin, rewrites the section and invalidates reuse from that point onward.

### Tool calls

#### What the model sees

Three schemas: `corpus_ingest` with a required `documents` array of `title`, `text`, and optional `source`; `corpus_search` with required `query` and optional `terms` and `limit`; `corpus_read` with required `docId` and `ordinal`. The descriptions carry the numeric bounds the config resolved to, and no schema exposes a timeout, a path, or a provider name.

#### Token effect

Cost scales with the descriptions, so a deployment that lowers `maxLimit` also shortens the search description it pays for on every request that carries the tool.

#### KV Cache effect

Stable across calls; only a configuration change that alters an advertised bound, or a scope whose visible tool set differs, changes the serialized schemas.

### Retrieved chunks

#### What the model sees

A header line such as `Matched 2 chunks (most relevant first).`, then per hit an attribution line and the chunk text, then the citation duty. A filled window appends the narrowing note, and an empty result states that nothing matched and names `corpus_search` and `corpus_ingest` as the next steps.

#### Token effect

Dominated by returned chunk text: `defaultLimit` full chunks of provider-chosen size plus roughly one hundred tokens of framing. `maxSnippetChars` does not limit the model-facing text, only the client snippet.

#### KV Cache effect

Tool results enter the transcript, not the cached prefix; retrieval bounds affect the cache only through the guidance and description text they advertise.

### Index failures

#### What the model sees

Accepted documents are reported with chunk and byte counts, refusals under `Rejected documents (N):` with the provider's code and message, so an empty text or an oversized document is visible per document. A batch that violates a bound instead returns the rejection message and indexes nothing.

#### Token effect

Proportional to the number of documents in the call, with one line per accepted document and one per refusal.

#### KV Cache effect

None beyond the transcript the call appends; the guidance states the bounds and does not change with them.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are incomplete or need deployment cooperation. They are current package constraints.

- **Ingest is the only way text enters the index** — the tools never read the filesystem or a URL, so a deployment that wants documents pre-loaded must call `corpus_ingest` itself or mount a provider that seeds itself at start.
- **Chunk layout is the provider's choice** — the tools neither set chunk size nor overlap nor heading depth, so a model cannot ask for a finer or coarser passage than the mounted provider produced.
- **`truncated` is window fullness, not corpus exhaustion** — the provider returns hits without a total count, so a full window only licenses the claim that more may exist.
- **No delete or list tool** — the seam exposes `listDocuments` and `remove`, and this package registers no tool for them, so a model cannot inspect or revise what is indexed; the deployment owns retention.
- **Citation is instructed, not verified** — the guidance and the result text require a document title, ordinal, and character range, and nothing checks that the model actually quoted the chunk it cited.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked pages.

#### Future: retrieval over document subsets

`ctx.corpus.search` takes no document filter, so a deployment with several corpora cannot scope a model's retrieval to one of them. A `docId` or tag filter would need the provider to support it first, which is why the tools advertise no such argument.

</details>

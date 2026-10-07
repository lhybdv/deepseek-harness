---
description: "Corpus retrieval capability for the harness meteorology tools: what the ctx.corpus seam offers, and how the SQLite provider indexes and retrieves Chinese text."
kind: "package-reference"
---

# @deepseek-ai/dsh-meteo-corpus

English | [中文](README.zh.md)

## Summary

`dsh-meteo-corpus` ingests uploaded documents into heading-scoped chunks and retrieves the chunks that best answer a question, each carrying the document id, ordinal, and character offsets a citation needs. Give it its own SQLite file and mount it as `ctx.corpus`. Retrieval combines dense semantic recall with the Chinese bigram FTS5 index whenever an embedding provider is mounted; with none mounted the corpus still ingests and answers, retrieving lexically and reporting the missing service once.

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

Mount the package as a plugin row and it registers as `ctx.corpus`.

### When to choose it

Choose it when a deployment holds professional text that answers questions about places, activities, or hazards, and the answers must cite where they came from. The store is a single-owner local index: choose a remote retrieval service instead when several processes or machines must share one corpus. Choose the plain filesystem and the model's own `read`/`grep` tools instead when the corpus is a handful of short documents that fit in context.

### Minimal configuration

```yaml
- id: meteo-corpus
  name: '@deepseek-ai/dsh-meteo-corpus'
  config:
    path: !!js `${process.env.DSH_HOME}/meteo/corpus.v1.sqlite`
```

| Field | Default | Meaning |
|---|---|---|
| `path` | required | Index file. `:memory:` runs the index without touching disk. |
| `journalMode` | `wal` | SQLite journal mode for the index file. |
| `defaultLimit` | `8` | Hits returned when a search omits `limit`. |
| `maxLimit` | `50` | Ceiling an explicit `limit` is clamped to. |
| `maxMatchTokens` | `64` | Upper bound on distinct MATCH tokens, bounding expression size. |
| `maxChunkChars` | `800` | Soft upper bound on a chunk's character count. |
| `maxDocumentBytes` | `4000000` | Largest accepted document, in UTF-8 bytes. |
| `embeddingBatchSize` | `32` | Maximum chunks sent to an embedding provider in one request. |
| `candidateLimit` | `100` | Maximum lexical and semantic candidates fused per query. |

### Choosing the index file

Give the corpus its own database file. A sibling derived index refuses a file whose `application_id` belongs to someone else and drops every table when `user_version` moves; this store applies the same rules in reverse. Its schema stores each chunk vector beside the text and FTS rows. Updating the schema version rebuilds this derived database, so re-ingest sources after a version or embedding-model change.
### Embedding provider

Semantic retrieval is an optional peer, not a load-time dependency: the corpus resolves `ctx.get('textEmbeddings')` at the point of use, so mounting order is irrelevant and it boots, ingests, and answers with no provider at all.

Mount `@deepseek-ai/dsh-text-embeddings` and one provider to add it. Then `ingest` stores one vector per chunk and `search` fuses vector recall with BM25. With nothing mounted, `ingest` stores no vectors, `search` retrieves lexically over the Chinese bigram index, and the store warns once naming `textEmbeddings` — it never fabricates a vector and never embeds locally.

The provider's configured model must be identical for indexing and querying; changing models requires re-ingest. Choose the local ONNX provider when model files are deployed with the host, or the OpenAI-compatible provider when an embeddings endpoint is available.

### Supplying expansion terms

`search` takes the question and, separately, the domain terms a caller derived from it. Recall unions both. The meteorology tools pass terms from their intent parse and their synonym table, which is what carries a colloquial question past the words no professional corpus contains.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`text.ts` owns both halves of the token contract — `chunkText` for indexing and `bigrams` for the storage and query token form — because a divergence between the two sides silently destroys recall. `indexTokens` writes the stored column; `match.ts` reaches the same function and OR-joins quoted tokens, taking the question's tokens first so that a truncated expression keeps the question's subject and drops the expansion terms.

The chunker walks source spans that tile the document exactly — one sentence, terminator included, or one bare newline — and packs contiguous runs of them into a chunk. Because the spans tile, a chunk's `charStart`/`charEnd` address the original text including the newlines between lines, which is what makes a citation rendered from the chunk match the source.

`ingest` writes each document's chunk rows and FTS rows first and its `docs` row last, plus one vector row per chunk when an embedding provider is mounted. That row is the visibility gate: retrieval joins through it, so an ingest interrupted part-way leaves only chunk rows no query returns, rather than a document reporting a count it does not have. Failures are per source — one rejected document never aborts its siblings.

`search` gathers up to `candidateLimit` BM25 candidates and up to `candidateLimit` vector-cosine candidates, then combines their ranks using reciprocal-rank fusion: each list contributes `1 / (60 + rank)` (one-based rank). The fused score is the sum; candidate identity is unique by document and chunk. Fusion preserves exact-vocabulary signals while allowing semantic-only results. Without an embedding provider the vector half is skipped entirely — no query vector is computed and the vector table is never read — so the same ranking degenerates to the BM25 order. `matchExpression` reports the FTS query even when only semantic recall found a hit.

The database handle opens lazily on first use and closes through a fiber effect, so a composition that mounts this plugin without ingesting or searching pays nothing, and reloading a composition does not leak the file lock. `node:sqlite` is imported dynamically inside that open for the same reason.

**Runtime invariant:** No companion is published. The index is a disposable derived artifact the store owns end to end — a chunk's identity, its offsets, and its token column are written together under the store's own schema version — so no independent observation of the index can disagree with it.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-session-query-sqlite`](../../session-query/session-query-sqlite/README.md) — the sibling derived index whose ownership guards this store mirrors and whose file it must never share.
- [Capability seams](../../../docs/capability-seams.md) — where a Service Definition sits among its provider and consumer.

## Model Experience

### Retrieved chunks

#### What the model sees

Nothing reaches the model from this package directly: it registers no tool and contributes no prompt text. What the model sees is what a consuming meteorology tool returns — ranked chunks, each labelled with its document title, its chunk ordinal, and the heading trail above it, plus the citation list the tool attaches. The index, the stored token column, and this package's configuration stay invisible.

#### Token effect

Chunk text enters the model's context only as part of a tool result, so its cost is that result's size and is bounded by the calling tool's own limit policy rather than by `defaultLimit`, which bounds retrieval alone.

#### KV Cache effect

No direct invalidation. Retrieved chunks are appended to a request as tool-result content, and the consumer that decides how many to include owns the resulting prompt-prefix behavior.

## Known Limitations and Deferred Work

- Semantic retrieval is opt-in. The package bundles no provider and requires none: with no embedding provider mounted, `ingest` stores no vectors and retrieval is lexical (BM25 over the Chinese bigram index). A deployment that wants fused semantic recall mounts `@deepseek-ai/dsh-text-embeddings` plus a provider; see [Embedding provider](#embedding-provider).
- Chunking is heading- and sentence-aware only. A document with no structure falls back to one sentence-packed stream.
- Ingest parsing covers plain text and Markdown. Office and PDF extraction is deferred; a caller must supply text.
- `DatabaseSync` is synchronous, so ingest blocks the event loop for the duration of one document. Very large corpora should be ingested outside a live conversation.
- The index is per-file and single-owner. There is no multi-process coordination and no incremental reindex of a changed source document.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

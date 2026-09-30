# Meteorology consultation

English | [中文](meteo.zh.md)

The [meteo group](../../packages/meteo/README.md) supplies the capabilities a deployment needs to answer questions about a township — what the observations and forecast say, whether a farming activity is suitable over a stated window, what disaster risk a period carries, and which professional sources support the conclusion. Two seams are in place so far: the meteorological data seam (`ctx.meteoData`) and the corpus retrieval seam (`ctx.corpus`). Both are ordinary capability seams: a Service Definition declares what the capability does, one provider ships beside it, and a model-facing tool package consumes it.

Sources: [`packages/meteo/meteo-data/src/definition.ts`](../../packages/meteo/meteo-data/src/definition.ts), [`packages/meteo/meteo-corpus/src/definition.ts`](../../packages/meteo/meteo-corpus/src/definition.ts).

## Meteorological data

The data seam answers questions about stations, what a station measured, what it is forecast to measure, which thresholds a deployment treats as significant, and which farming activities have a suitable window. It owns no judgement: it returns records, and the rule verdicts that combine them belong to the consultation tools.

A deployment selects the source from configuration rather than code. The shipped `fixture` source reads a JSON bundle from a directory, which is what makes a demonstration runnable without a live upstream; the `http` source reads the same shapes from an origin root. A deployment that points `baseUrl` at a real business API changes nothing above the seam.

`getSectionOrder('TOOL_METEO_CORPUS')` and the sibling prompt-section names are allocated centrally in `packages/core/system-prompt/src/index.ts`, so a domain tool's guidance takes its place in the assembled prompt through the same registry every other tool uses rather than by a private number.

## Cross-turn consultation subject

A consultation spans turns: a follow-up such as "那后天呢？" names no station and no crop, and the answer is only correct if the earlier ones still apply. The data seam owns that state as an ordinary session event, `meteo/focus`, carrying the whole post-change snapshot rather than a delta. The registered projection folds it into one current value, so a reader never reconstructs the subject by walking history and a replay after a reload reaches the same answer.

Keeping this in the session log rather than in the tool implementation is what makes the multi-turn behaviour auditable: the recorded focus is the same value the answer was built from.

## Corpus retrieval

The retrieval seam ingests uploaded documents, splits them into heading-scoped chunks, indexes them, and returns the chunks that best answer a question together with the character offsets a citation needs to point back at the source text.

The index is a disposable derived artifact in its own database file. It stores a CJK bigram token form alongside each chunk's verbatim text, because SQLite's `unicode61` tokenizer treats an unbroken Han run as a single token and cannot answer a two-character query against the raw text. Retrieval unions the question's tokens with expansion terms the caller derived from it and ORs them: an AND-joined colloquial question returns nothing as soon as one of its words is absent from the corpus, which is the normal case for a question phrased the way a farmer asks it.

The seam returns scored chunks and no policy. How many to cite, whether to rerank, and what a conclusion must cite belong to the consuming tools.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcorpus--corpusstore-abstract-seam"></a>

### `ctx.corpus` — `CorpusStore` (abstract seam)

Abstract corpus store. Subclass, implement every method, and load the subclass as a plugin — it registers as `ctx.corpus` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- `ingest` indexes each accepted source independently: a source rejected for its own reason is reported in IngestResult.failures and never aborts the others.
- `search` is recall-oriented. An empty result is a legitimate answer and callers must tolerate it; the implementation must not substitute a fallback query the caller did not ask for.
- `readChunk` returns the stored chunk verbatim, so a citation rendered from it matches the source document's characters at `charStart`–`charEnd`.
- Every method rejects only on a real backend failure.

```ts cordis-catalog
/**
 * Split, tokenize, and index each source.
 * @param request - the sources to ingest.
 * @returns the stored documents and the per-source failures.
 */
abstract ingest(request: IngestRequest): Promise<IngestResult>

/**
 * Retrieve the chunks that best match a question.
 * @param request - the question, its expansion terms, and an optional hit limit.
 * @returns ranked hits and the MATCH expression that produced them.
 */
abstract search(request: SearchRequest): Promise<SearchResult>

/**
 * Read one stored chunk verbatim.
 * @param docId - the document to read from.
 * @param ordinal - the chunk's position inside that document.
 * @returns the chunk, or `undefined` when the document or ordinal is unknown.
 */
abstract readChunk(docId: CorpusDocumentId, ordinal: number): Promise<CorpusChunk | undefined>

/**
 * List the indexed documents, newest first.
 * @param limit - optional cap on the number of documents returned.
 * @returns the document records without their chunk text.
 */
abstract listDocuments(limit?: number): Promise<CorpusDocument[]>

/**
 * Remove a document and its chunks.
 * @param docId - the document to remove.
 * @returns whether a document was actually removed.
 */
abstract remove(docId: CorpusDocumentId): Promise<RemoveResult>
```

Source: [`packages/meteo/meteo-corpus/src/definition.ts`](../../packages/meteo/meteo-corpus/src/definition.ts)

<a id="ctxmeteocontroller--meteocontroller"></a>

### `ctx.meteoController` — `MeteoController`

Host service backing the generated `ctx.remote.meteo` namespace. Every method delegates to the seam that owns the answer and carries only what a browser call adds: the request bounds the wire codec cannot state, the view a panel renders, and a named failure where a seam's silence would otherwise read as success.

```ts cordis-catalog
/**
 * List the indexed documents, newest ingest first.
 * @param limit - documents to return, at most {@link MAX_LIST_DOCS}; `undefined` returns the whole index.
 * @returns one entry per stored document.
 * @throws RemoteError when `limit` is not a positive integer within the bound.
 */
@Remote async corpusList(limit: number | undefined): Promise<MeteoDocument[]>

/**
 * Index submitted documents.
 * @param sources - one to {@link MAX_INGEST_SOURCES} documents; a title must not be empty,
 *   while the source label may be. Empty or oversized text is the store's per-document
 *   failure, reported in the result rather than raised here, so one rejected document never
 *   aborts its siblings.
 * @returns the stored documents and the per-source refusals.
 * @throws RemoteError when the batch is empty, oversized, or a source has no title.
 */
@Remote async corpusIngest(sources: readonly MeteoIngestSource[]): Promise<MeteoIngestValue>

/**
 * Search the indexed documents for one question.
 * @param query - the question, used as-is for recall.
 * @param terms - domain terms derived from the question; recall unions them with its own tokens.
 * @param limit - hits wanted; the store clamps it to its own configured ceiling. `undefined` takes its default.
 * @returns the ranked hits with the citation fields and a capped excerpt, plus the match expression issued.
 * @throws RemoteError when the query or a term is empty, or `limit` is not a positive integer.
 */
@Remote async corpusSearch( query: string, terms: readonly string[] | undefined, limit: number | undefined, ): Promise<MeteoSearchValue>

/**
 * Reopen one stored chunk in full, which is what a panel does when a hit's
 * excerpt is not enough to read the passage it cites.
 * @param docId - indexed document to read from.
 * @param ordinal - zero-based chunk position inside that document.
 * @returns the stored chunk verbatim, with the character offsets of the source document.
 * @throws RemoteError when the address is malformed or the chunk is not in the index.
 */
@Remote async corpusRead(docId: MeteoDocumentId, ordinal: number): Promise<MeteoChunk>

/**
 * Withdraw one document from the index.
 * @param docId - document to remove.
 * @returns the removal outcome; `removed: false` is an answer, not a failure — the document
 *   was already gone, which is the state the panel wanted.
 * @throws RemoteError when the document id is empty.
 */
@Remote async corpusRemove(docId: MeteoDocumentId): Promise<MeteoRemoveValue>

/**
 * Read the place and crop this session's consultation is working on, which is
 * how a panel shows what the model currently believes it is answering about.
 * @param agent - target Agent resolved from the Session identity on the wire.
 * @returns the focus this session last wrote, or `null` when it has none.
 */
@Remote focusGet(agent: Agent): MeteoFocus | null

/**
 * Look stations up by name, township, or county.
 * @param text - substring matched against station name, township and county.
 * @param county - keep only stations of this county-level division.
 * @returns the matching stations, in dataset order.
 * @throws RemoteError when neither filter is given, or the data seam cannot answer.
 */
@Remote async stationLookup(text: string | undefined, county: string | undefined): Promise<readonly MeteoStation[]>
```

Types: [Agent](core.md)

Source: [`packages/api/meteo-controller/src/index.ts`](../../packages/api/meteo-controller/src/index.ts)

<a id="ctxmeteodata--meteodata-abstract-seam"></a>

### `ctx.meteoData` — `MeteoData` (abstract seam)

Abstract meteorological data seam. Subclass, implement every method, and load the subclass as a plugin — it registers as `ctx.meteoData` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- Every method is read-only and idempotent: the same query returns the same answer until a dataset revision changes.
- An empty list is a legitimate answer for a station that exists but has no data in the requested window; an unknown station id is not, and rejects with `METEO_STATION_NOT_FOUND`.
- Times are ISO-8601 instants and window bounds are inclusive, so two consumers asking about the same period read the same rows.
- A dataset that cannot be read or does not match its published shape rejects with `METEO_DATASET_UNAVAILABLE`; the seam never substitutes plausible numbers.

```ts cordis-catalog
/**
 * List the stations this deployment covers.
 * @param query - county filter and free-text filter over name, township, county.
 * @returns the matching stations, in dataset order.
 */
abstract stations(query?: StationQuery): Promise<readonly Station[]>

/**
 * Resolve one station by id.
 * @param id - the station identifier to look up.
 * @returns the station, or `undefined` when no station carries that id.
 */
abstract station(id: string): Promise<Station | undefined>

/**
 * Read observed weather for one station.
 * @param query - the station and an inclusive time window.
 * @returns the observations in the window, oldest first.
 */
abstract observations(query: ObservationQuery): Promise<readonly Observation[]>

/**
 * Read the forecast guide for one station.
 * @param query - the station, an inclusive start, and a horizon in hours.
 * @returns the forecast points in range, earliest first.
 */
abstract forecast(query: ForecastQuery): Promise<readonly ForecastPoint[]>

/**
 * List graded disaster criteria.
 * @param query - disaster name and crop filters.
 * @returns the criteria issued for the filter, in the order the dataset publishes them.
 */
abstract thresholds(query?: ThresholdQuery): Promise<readonly Threshold[]>

/**
 * List farming activity windows and the criteria that grade them.
 * @param query - crop filter, and a disaster filter over each window's criteria.
 * @returns the matching windows, in the order the dataset publishes them.
 */
abstract cropCalendar(query?: ThresholdQuery): Promise<readonly CropWindow[]>

/**
 * Expand a colloquial disaster or element term into the vocabulary the
 * datasets use, so a consumer can match a farmer's wording.
 * @param term - the term as a person wrote it.
 * @returns related terms, or an empty list when the term is unknown.
 */
abstract expandTerm(term: string): Promise<readonly string[]>

/**
 * Report the revision of the dataset bundle behind this seam.
 * @returns the bundle revision and the revision of every dataset.
 */
abstract versions(): Promise<DatasetVersions>
```

Source: [`packages/meteo/meteo-data/src/definition.ts`](../../packages/meteo/meteo-data/src/definition.ts)
<!-- END GENERATED cordis-surface -->

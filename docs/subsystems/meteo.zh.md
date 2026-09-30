# 气象咨询

[English](meteo.md) | 中文

[meteo 组](../../packages/meteo/README.zh.md)提供部署回答"某个乡镇"相关问题所需的能力：实况与预报怎么说、某项农事活动在给定时段内是否适宜、某段时间带什么灾害风险，以及哪些专业来源支撑该结论。目前已有两个接缝：气象数据接缝（`ctx.meteoData`）与语料检索接缝（`ctx.corpus`）。二者都是标准的能力接缝：一个 Service Definition 声明该能力做什么，一个 provider 随包发布，一个面向模型的工具包消费它。

Sources: [`packages/meteo/meteo-data/src/definition.ts`](../../packages/meteo/meteo-data/src/definition.ts), [`packages/meteo/meteo-corpus/src/definition.ts`](../../packages/meteo/meteo-corpus/src/definition.ts).

## 气象数据

数据接缝回答四类问题：有哪些站点、某站实测了什么、预报将测到什么、部署把哪些阈值视为显著，以及哪些农事活动存在适宜窗口。它不做判断：它返回记录，而把记录合成为结论的规则研判属于咨询工具。

部署通过配置而非代码选择数据源。随包发布的 `fixture` 源从目录读取 JSON 包，这正是演示能在没有实时上游的情况下跑起来的原因；`http` 源从源站根读取同样的结构。把 `baseUrl` 指向真实业务接口的部署，不改变接缝之上任何东西。

`getSectionOrder('TOOL_METEO_CORPUS')` 与同族的提示词段落名在 `packages/core/system-prompt/src/index.ts` 中集中分配，因此领域工具的指引经由与其他所有工具相同的注册表进入装配后的提示词，而不是靠一个私有数字。

## 跨轮咨询主体

一次咨询横跨多个回合：像"那后天呢？"这样的追问既没点名站点也没点名作物，只有先前的设定仍然适用时答案才正确。数据接缝把该状态作为普通的会话事件 `meteo/focus` 拥有，携带变更后的**完整快照**而非增量。注册的投影把它折叠为一个当前值，因此读取方从不靠遍历历史重建主体，重载后的回放也得到同一个答案。

把它放在会话日志而不是工具实现里，正是多轮行为可审计的原因：被记录下来的焦点，就是答案所依据的那个值。

## 语料检索

检索接缝摄取上传的文档，切分为按标题分块的片段，建立索引，并返回最能回答某个提问的片段，附带引用所需、能指回原文的字符偏移。

索引是一个可丢弃的派生产物，位于自己的数据库文件中。它除每块的原文字外还存储中文 bigram 词形，因为 SQLite 的 `unicode61` 分词器会把一整段连续汉字当成单个 token，无法对原文回答双字查询。检索把提问的 token 与调用方从提问推导出的扩展词取并集后做 OR：用 AND 连接的口语问句只要有一个词不在语料中便返回空，而这恰恰是农民式问法的常态。

接缝只返回带分数的片段，不含任何策略。引用多少条、是否重排、结论必须引用什么，属于消费它的工具。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 *   while a provenance label may be. Empty or oversized text is the store's per-document
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

Types: [Agent](core.zh.md)

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

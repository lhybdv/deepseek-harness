/**
 * The corpus page: the index a consultation cites from, and the place a reader
 * uploads and manages it.
 *
 * The page owns no business state — the index lives in the corpus service behind
 * the `meteo` Remote namespace, and every gesture here is one call that answers
 * with the index's new state. What the page keeps is the reading state of its
 * surfaces (the document list, the upload batch, the search) and the last
 * failure each answered with.
 *
 * Uploads are files, read in the browser. A file that is not text is refused
 * here rather than sent: extending to formats a browser cannot decode needs a
 * server-side extractor, and pretending a `.pdf` is text would index its bytes.
 * The refusal is per file and names the reason, so one bad pick never hides the
 * files that were accepted.
 *
 * @module @deepseek-ai/dsh-client-ui-meteo/CorpusPage
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MeteoChunk, MeteoDocument, MeteoDocumentId, MeteoIngestFailure, MeteoSearchHit,
} from '@deepseek-ai/dsh-api-meteo-controller/types'
import type {} from './locales.ts'
import type { MeteoFace } from './face.ts'
import css from './CorpusPage.module.css'

/** The page's injected business face, as the panel receives it. */
export interface CorpusPageInjected {
  /** Bound `meteo` calls the page reads and writes the index through. */
  readonly meteo: MeteoFace
}

/** The page's composed props. */
export type CorpusPageProps = CorpusPageInjected & PropsLocale<'meteo'>

/** One selected file, read into memory when it was picked. */
export interface StagedFile {
  /** The file's name on disk, shown in the batch. */
  readonly name: string
  /** The document title the wire receives: the name without its decoded suffix. */
  readonly title: string
  /** The file's decoded text. */
  readonly text: string
  /** The file's size on disk, for the row's account of what will be indexed. */
  readonly bytes: number
}

/** Why the page refused one selected file, before the index ever saw it. */
export type StagedRefusalReason = 'binary' | 'empty' | 'tooLarge'

/** One refusal the page itself made, named so the reader can act on it. */
export interface StagedRefusal {
  /** The refused file's name. */
  readonly name: string
  /** Why it was refused. */
  readonly reason: StagedRefusalReason
}

/**
 * Extensions the page decodes itself. Everything else needs extraction this
 * deployment does not ship, so it is refused rather than indexed as bytes.
 */
const DECODABLE_FILE_SUFFIXES = ['.md', '.markdown', '.txt', '.text', '.json', '.csv', '.log', '.yaml', '.yml'] as const

/**
 * The longest text the page will stage. Kept at the index's own per-document
 * cap, so an over-long file fails here with a reason the reader can act on
 * instead of travelling to the Host to be refused there.
 */
export const MAX_STAGED_CHARS = 200_000

/** The dictionary key for each reason the page refuses a file. */
const REFUSAL_KEYS: Record<StagedRefusalReason, 'ingest.reject.binary' | 'ingest.reject.empty' | 'ingest.reject.tooLarge'> = {
  binary: 'ingest.reject.binary',
  empty: 'ingest.reject.empty',
  tooLarge: 'ingest.reject.tooLarge',
}

/**
 * Whether the page can decode a file itself, by its name.
 * @param name - the selected file's name.
 * @returns true when the extension is one this page reads as text.
 */
export function isTextFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return DECODABLE_FILE_SUFFIXES.some(extension => lower.endsWith(extension))
}

/**
 * The document title one file becomes: its name without the suffix the page
 * decoded it by, because the suffix describes the file rather than the material.
 * @param name - the selected file's name.
 * @returns the title the index receives.
 */
export function titleOfFileName(name: string): string {
  const lower = name.toLowerCase()
  const suffix = DECODABLE_FILE_SUFFIXES.find(candidate => lower.endsWith(candidate))
  return suffix === undefined ? name : name.slice(0, name.length - suffix.length)
}

/**
 * The copy for one refused source, naming the source and why it was refused.
 * @param t - namespace-bound translate.
 * @param failure - one source the index refused, with its stable code.
 * @returns the line the upload form shows for that source.
 */
export function refusalText(t: TranslateNS<'meteo'>, failure: MeteoIngestFailure): string {
  const reason = failure.code === 'CORPUS_EMPTY_DOCUMENT'
    ? t('ingest.reject.empty')
    : t('ingest.reject.tooLarge')
  return t('ingest.rejected', { title: failure.title, reason })
}

/**
 * The copy for one file the page refused before uploading it.
 * @param t - namespace-bound translate.
 * @param refusal - the refused file and the page's own reason.
 * @returns the line the upload form shows for that file.
 */
export function stagedRefusalText(t: TranslateNS<'meteo'>, refusal: StagedRefusal): string {
  return t('ingest.rejected', { title: refusal.name, reason: t(REFUSAL_KEYS[refusal.reason]) })
}

/**
 * The one-line summary under a document's title: how much of it there is, where
 * it came from, and when it was indexed.
 * @param t - namespace-bound translate.
 * @param document - the indexed document.
 * @returns the summary line.
 */
export function documentMetaText(t: TranslateNS<'meteo'>, document: MeteoDocument): string {
  const parts = [
    t('page.chunks', { count: document.chunkCount }),
    t('page.size', { size: document.bytes }),
  ]
  // A source is optional on the wire, so an empty one is left out rather than
  // rendered as a label with nothing after it.
  if (document.source !== '') parts.push(t('page.sourceLine', { source: document.source }))
  parts.push(t('page.ingested', { time: new Date(document.ingestedAt).toLocaleString() }))
  return parts.join(' · ')
}

/**
 * The character range one hit covers, as its row shows it.
 * @param t - namespace-bound translate.
 * @param hit - one retrieved chunk.
 * @returns the prepared range line.
 */
export function hitRangeText(t: TranslateNS<'meteo'>, hit: MeteoSearchHit): string {
  return t('search.hit.range', { start: hit.charStart, end: hit.charEnd })
}

/** Which surface is waiting on the Host, so each disables on its own call. */
type Pending = 'list' | 'ingest' | 'search' | null

/** One completed search: the query that produced it, and the rows. */
interface SearchResult {
  readonly query: string
  readonly hits: readonly MeteoSearchHit[]
}

/** The chunk list of one document, read on demand. */
interface Inspection {
  readonly docId: MeteoDocumentId
  readonly chunks: readonly MeteoChunk[]
}

/** Read every selected file the page can decode itself. */
async function readFiles(files: readonly File[]): Promise<{
  readonly staged: readonly StagedFile[]
  readonly refused: readonly StagedRefusal[]
}> {
  const staged: StagedFile[] = []
  const refused: StagedRefusal[] = []
  for (const file of files) {
    if (!isTextFileName(file.name)) {
      refused.push({ name: file.name, reason: 'binary' })
      continue
    }
    const text = await file.text()
    if (text.trim() === '') {
      refused.push({ name: file.name, reason: 'empty' })
      continue
    }
    if (text.length > MAX_STAGED_CHARS) {
      refused.push({ name: file.name, reason: 'tooLarge' })
      continue
    }
    staged.push({ name: file.name, title: titleOfFileName(file.name), text, bytes: file.size })
  }
  return { staged, refused }
}

/**
 * Render the corpus page.
 * @param props - the bound `meteo` face and the page's copy.
 * @returns the page.
 */
export function CorpusPage({ meteo, t }: CorpusPageProps): ReactNode {
  const [documents, setDocuments] = useState<readonly MeteoDocument[]>([])
  const [loaded, setLoaded] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [staged, setStaged] = useState<readonly StagedFile[]>([])
  const [stagedRefused, setStagedRefused] = useState<readonly StagedRefusal[]>([])
  const [source, setSource] = useState('')
  const [refused, setRefused] = useState<readonly MeteoIngestFailure[]>([])
  const [ingestError, setIngestError] = useState<string | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [inspecting, setInspecting] = useState<MeteoDocumentId | null>(null)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<MeteoChunk | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setPending('list')
    setListError(null)
    const answer = await meteo.listDocuments()
    if (answer.ok) {
      setDocuments(answer.value)
      setLoaded(true)
    } else {
      setLoaded(false)
      setListError(answer.error.message)
    }
    setPending(null)
  }, [meteo])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (docId: MeteoDocumentId): Promise<void> => {
    setPending('list')
    setListError(null)
    const answer = await meteo.removeDocument(docId)
    if (answer.ok && answer.value.removed) {
      setDocuments(current => current.filter(document => document.docId !== docId))
      setResult(current => current === null
        ? null
        : { query: current.query, hits: current.hits.filter(hit => hit.docId !== docId) })
      setInspection(current => current === null || current.docId !== docId ? current : null)
    } else if (!answer.ok) {
      setListError(answer.error.message)
    }
    setPending(null)
  }

  const pick = async (files: readonly File[]): Promise<void> => {
    const { staged: accepted, refused: denied } = await readFiles(files)
    setStaged(current => [...current, ...accepted])
    setStagedRefused(denied)
  }

  const ingest = async (): Promise<void> => {
    setPending('ingest')
    setIngestError(null)
    setRefused([])
    const answer = await meteo.ingest(staged.map(file => ({ title: file.title, text: file.text, source })))
    if (answer.ok) {
      setDocuments(answer.value.documents)
      setLoaded(true)
      setRefused(answer.value.failures)
      // Only the files the index accepted leave the batch; a refused one stays
      // staged so the reader can fix the source and send it again.
      const rejected = new Set(answer.value.failures.map(failure => failure.title))
      setStaged(current => current.filter(file => rejected.has(file.title)))
    } else {
      setIngestError(answer.error.message)
    }
    setPending(null)
  }

  const inspect = async (document: MeteoDocument): Promise<void> => {
    if (inspection !== null && inspection.docId === document.docId) {
      setInspection(null)
      return
    }
    setInspecting(document.docId)
    setInspectError(null)
    const chunks: MeteoChunk[] = []
    for (let ordinal = 0; ordinal < document.chunkCount; ordinal += 1) {
      const answer = await meteo.readChunk(document.docId, ordinal)
      if (!answer.ok) {
        setInspectError(answer.error.message)
        setInspection(null)
        setInspecting(null)
        return
      }
      chunks.push(answer.value)
    }
    setInspection({ docId: document.docId, chunks })
    setInspecting(null)
  }

  const search = async (): Promise<void> => {
    setPending('search')
    setSearchError(null)
    const asked = query
    const answer = await meteo.search(asked)
    if (answer.ok) setResult({ query: asked, hits: answer.value.hits })
    else setSearchError(answer.error.message)
    setPending(null)
  }

  const readEvidence = async (docId: MeteoDocumentId, ordinal: number): Promise<void> => {
    setEvidenceError(null)
    const answer = await meteo.readChunk(docId, ordinal)
    if (answer.ok) {
      setEvidence(answer.value)
      return
    }
    setEvidence(null)
    setEvidenceError(answer.error.code === 'meteo/chunk-not-found'
      ? t('citation.notFound')
      : t('citation.error', { message: answer.error.message }))
  }

  const ready = staged.length > 0

  return (
    <div className={css.page}>
      <div className={css.header}>
        <div>
          <h1 className={css.title}>{t('page.title')}</h1>
          <p className={css.description}>{t('page.description')}</p>
        </div>
        <Button size="sm" disabled={pending !== null} onClick={() => { void load() }}>
          {t('page.reload')}
        </Button>
      </div>

      <section className={css.section}>
        <h2 className={css.sectionTitle}>{t('page.listTitle')}</h2>
        {listError !== null && <p className={css.error} role="alert">{t('page.listError', { message: listError })}</p>}
        {inspectError !== null && <p className={css.error} role="alert">{t('page.inspectError', { message: inspectError })}</p>}
        {!loaded
          ? <div className={css.empty}>{pending === 'list' ? t('page.loading') : ''}</div>
          : (
            <div className={css.list}>
              {documents.length === 0
                ? <div className={css.empty}>{t('page.empty')}</div>
                : documents.map(document => (
                  <div className={css.row} key={document.docId}>
                    <div className={css.rowMain}>
                      <span className={css.rowTitle} title={document.title}>{document.title}</span>
                      <span className={css.rowMeta}>{documentMetaText(t, document)}</span>
                    </div>
                    <div className={css.actions}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending !== null || inspecting !== null}
                        onClick={() => { void inspect(document) }}
                      >
                        {inspecting === document.docId
                          ? t('page.inspecting')
                          : inspection !== null && inspection.docId === document.docId
                            ? t('page.collapse')
                            : t('page.inspect')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending !== null}
                        onClick={() => { void remove(document.docId) }}
                      >
                        {t('page.remove')}
                      </Button>
                    </div>
                    {inspection !== null && inspection.docId === document.docId ? (
                      <div className={css.chunkList}>
                        {inspection.chunks.map(chunk => (
                          <div className={css.chunkRow} key={chunk.ordinal}>
                            <span className={css.chunkHead}>
                              {t('page.chunkLine', { ordinal: chunk.ordinal, start: chunk.charStart, end: chunk.charEnd })}
                            </span>
                            <p className={css.chunkText}>{chunk.text}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
            </div>
          )}
      </section>

      <section className={css.section}>
        <h2 className={css.sectionTitle}>{t('ingest.title')}</h2>
        <div className={css.form}>
          <div className={css.actions}>
            <input
              className={css.fileInput}
              type="file"
              multiple
              aria-label={t('ingest.pick')}
              data-testid="corpus-file-input"
              onChange={(event) => {
                // A file input's `files` is always a FileList; the DOM type stays
                // nullable because the same property exists on inputs that are
                // not file inputs, which this element never is.
                const picked = Array.from(event.currentTarget.files as FileList)
                // The input keeps its value so the same file can be re-picked
                // after a refusal; the batch is what the page tracks.
                event.currentTarget.value = ''
                void pick(picked)
              }}
            />
            <span className={css.hint}>{t('ingest.hint')}</span>
          </div>
          <label className={css.field}>
            <span className={css.label}>{t('ingest.source')}</span>
            <Input
              value={source}
              placeholder={t('ingest.source.placeholder')}
              onChange={(event) => { setSource(event.target.value) }}
            />
          </label>
          {staged.length > 0 && (
            <div className={css.staged}>
              <span className={css.label}>{t('ingest.staged', { count: staged.length })}</span>
              {staged.map(file => (
                <div className={css.stagedRow} key={file.name}>
                  <span className={css.stagedName}>{file.name}</span>
                  <span className={css.rowMeta}>{t('page.size', { size: file.bytes })}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setStaged(current => current.filter(entry => entry !== file)) }}
                  >
                    {t('ingest.drop')}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className={css.actions}>
            <Button
              variant="primary"
              size="sm"
              disabled={pending !== null || !ready}
              onClick={() => { void ingest() }}
            >
              {pending === 'ingest' ? t('ingest.busy') : t('ingest.submit')}
            </Button>
          </div>
          {ingestError !== null && <p className={css.error} role="alert">{t('ingest.error', { message: ingestError })}</p>}
          {stagedRefused.map(denial => (
            <p className={css.notice} key={denial.name}>{stagedRefusalText(t, denial)}</p>
          ))}
          {refused.map(failure => (
            <p className={css.notice} key={failure.title}>{refusalText(t, failure)}</p>
          ))}
        </div>
      </section>

      <section className={css.section}>
        <h2 className={css.sectionTitle}>{t('search.title')}</h2>
        <div className={css.searchRow}>
          <Input
            value={query}
            placeholder={t('search.placeholder')}
            onChange={(event) => { setQuery(event.target.value) }}
          />
          <Button
            size="sm"
            disabled={pending !== null || query.trim() === ''}
            onClick={() => { void search() }}
          >
            {pending === 'search' ? t('search.busy') : t('search.submit')}
          </Button>
        </div>
        {searchError !== null && <p className={css.error} role="alert">{t('search.error', { message: searchError })}</p>}
        {evidenceError !== null && <p className={css.error} role="alert">{evidenceError}</p>}
        {result !== null && (
          result.hits.length === 0
            ? <div className={css.empty}>{t('search.none', { query: result.query })}</div>
            : (
              <div className={css.results}>
                {result.hits.map(hit => (
                  <div className={css.hit} key={`${hit.docId}:${String(hit.ordinal)}`}>
                    <div className={css.hitHead}>
                      <span className={css.hitTitle}>{hit.docTitle}</span>
                      <span className={css.hitTrail}>
                        {t('search.hit.chunk', { ordinal: hit.ordinal })}
                        {' · '}
                        {hitRangeText(t, hit)}
                      </span>
                    </div>
                    <p className={css.hitExcerpt}>{hit.excerpt}</p>
                    <div className={css.actions}>
                      <Button size="sm" onClick={() => { void readEvidence(hit.docId, hit.ordinal) }}>
                        {t('search.open')}
                      </Button>
                    </div>
                    {evidence !== null && evidence.docId === hit.docId && evidence.ordinal === hit.ordinal ? (
                      <div className={css.evidence}>
                        <pre className={css.evidenceText}>{evidence.text}</pre>
                        <span className={css.evidenceRange}>
                          {evidence.headingPath === '' ? t('citation.label') : evidence.headingPath}
                          {' · '}
                          {t('citation.range', { start: evidence.charStart, end: evidence.charEnd })}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )
        )}
      </section>
    </div>
  )
}

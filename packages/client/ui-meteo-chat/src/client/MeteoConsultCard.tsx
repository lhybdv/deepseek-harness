/**
 * The `meteo_consult` conversation card: a step-trace row whose summary is
 * the question the model asked, expanding to the six pipeline steps with
 * their one-line accounts, the per-step findings behind them (station,
 * observation rows, forecast rows, suitability days, hazard reading), the
 * clarification question when the consultation refused to read data, and the
 * retrieved chunk list last. A result whose metadata is missing or foreign
 * falls back to the generic input/output body, so a replay never breaks.
 */
import {
  IconDataOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { meteoCallArgsFormatted, meteoConsultModel } from './meteo-card-model.ts'
import type {
  MeteoClarificationMeta, MeteoConsultMeta, MeteoCriterionMeta, MeteoSeriesRowMeta, MeteoSuitabilityDayMeta,
} from './meteo-meta.ts'
import {
  MeteoGenericBody, MeteoInspectButton, disclosureLeading, disclosureProps,
  stateStatus, useDisclosure, type MeteoStateKeys, type MeteoT,
} from './meteo-chrome.tsx'
import { type MeteoChatKey } from './locales.ts'
import css from './MeteoCard.module.css'

/** Full props of the consultation card. */
export type MeteoConsultCardProps = ToolCallViewProps & PropsLocale<'meteoChat'>

const STATE_KEYS: MeteoStateKeys = {
  running: 'consult.running',
  failed: 'consult.failed',
  stopped: 'consult.stopped',
}

/** Pipeline step names the dictionaries localize; any other name renders raw. */
const STEP_KEYS: Readonly<Record<string, MeteoChatKey>> = {
  slots: 'consult.step.slots',
  observation: 'consult.step.observation',
  forecast: 'consult.step.forecast',
  suitability: 'consult.step.suitability',
  hazard: 'consult.step.hazard',
  corpus: 'consult.step.corpus',
}

/** Step outcome words the dictionaries localize; any other word renders raw. */
const STEP_STATUS_KEYS: Readonly<Record<string, MeteoChatKey>> = {
  done: 'consult.step.status.done',
  unknown: 'consult.step.status.unknown',
  skipped: 'consult.step.status.skipped',
}

/** Suitability verdicts the dictionaries localize; any other word renders raw. */
const VERDICT_KEYS: Readonly<Record<string, MeteoChatKey>> = {
  suitable: 'consult.verdict.suitable',
  unsuitable: 'consult.verdict.unsuitable',
  unknown: 'consult.verdict.unknown',
}

/** The clarification reasons the dictionaries carry, keyed by the wire value. */
const CLARIFICATION_KEYS: Readonly<Record<MeteoClarificationMeta['reason'], MeteoChatKey>> = {
  'station-not-found': 'consult.clarification.station-not-found',
  'station-ambiguous': 'consult.clarification.station-ambiguous',
  'station-missing': 'consult.clarification.station-missing',
}

/**
 * Localize one pipeline step name, keeping a foreign step verbatim.
 * @param step - the wire step name.
 * @param t - meteoChat translate seat.
 * @returns the display name.
 */
function stepName(step: string, t: MeteoT): string {
  const key = STEP_KEYS[step]
  return key === undefined ? step : t(key)
}

/**
 * Localize one step outcome, keeping a foreign outcome verbatim.
 * @param status - the wire outcome.
 * @param t - meteoChat translate seat.
 * @returns the display word.
 */
function stepStatus(status: string, t: MeteoT): string {
  const key = STEP_STATUS_KEYS[status]
  return key === undefined ? status : t(key)
}

/**
 * Localize one suitability verdict, keeping a foreign word verbatim.
 * @param verdict - the wire verdict word.
 * @param t - meteoChat translate seat.
 * @returns the display word.
 */
function verdictText(verdict: string, t: MeteoT): string {
  const key = VERDICT_KEYS[verdict]
  return key === undefined ? verdict : t(key)
}

/**
 * The step dot state for one wire outcome.
 * @param status - the wire outcome.
 * @returns done, a user-attention amber, or the quiet idle grey.
 */
function stepDot(status: string): 'done' | 'warning' | 'idle' {
  if (status === 'done') return 'done'
  if (status === 'unknown') return 'warning'
  return 'idle'
}

/**
 * One pipeline step: dot, localized name, localized outcome, the host's
 * one-line account, and the records it produced.
 * @param props.step - the narrowed step.
 * @param props.t - meteoChat translate seat.
 * @returns the step row.
 */
function MeteoStepRow({ step, t }: { step: MeteoConsultMeta['steps'][number]; t: MeteoT }) {
  return (
    <div className={css.stepRow}>
      <span className={css.stepState}><StateDot state={stepDot(step.status)} size={8} /></span>
      <span className={css.stepName}>{stepName(step.step, t)}</span>
      <span className={css.stepStatus}>{stepStatus(step.status, t)}</span>
      <span className={css.stepDetail}>{step.detail}</span>
    </div>
  )
}

/**
 * The six pipeline steps in the order they ran.
 * @param props.steps - the narrowed trace.
 * @param props.t - meteoChat translate seat.
 * @returns the steps section.
 */
function MeteoStepsSection({ steps, t }: { steps: MeteoConsultMeta['steps']; t: MeteoT }) {
  return (
    <section className={css.section} aria-label={t('consult.steps')}>
      <div className={css.sectionTitle}>{t('consult.steps')}</div>
      {steps.map(step => (
        <MeteoStepRow key={step.step} step={step} t={t} />
      ))}
    </section>
  )
}

/**
 * The elements of one observation or forecast row, e.g. `precipitation=12`.
 * @param row - the narrowed series row.
 * @returns the entry list.
 */
function seriesEntries(row: MeteoSeriesRowMeta): string {
  return row.entries.map(entry => `${entry.element}=${String(entry.value)}`).join('  ')
}

/**
 * One observation or forecast row: the instant and its element readings.
 * @param props.row - the narrowed series row.
 * @returns the row line.
 */
function MeteoSeriesLine({ row }: { row: MeteoSeriesRowMeta }) {
  return (
    <div className={css.seriesRow}>
      <span className={css.seriesTime}>{row.time}</span>
      <span className={css.seriesEntries}>{seriesEntries(row)}</span>
    </div>
  )
}

/**
 * The observation rows section, present only when readings exist.
 * @param props.rows - the narrowed observation rows.
 * @param props.t - meteoChat translate seat.
 * @returns the section, or null.
 */
function MeteoSeriesSection({ title, rows, t }: {
  title: MeteoChatKey
  rows: readonly MeteoSeriesRowMeta[]
  t: MeteoT
}) {
  if (rows.length === 0) return null
  return (
    <section className={css.section} aria-label={t(title)}>
      <div className={css.sectionTitle}>{t(title)}</div>
      {rows.map((row, index) => (
        <MeteoSeriesLine key={`${row.time}-${index}`} row={row} />
      ))}
    </section>
  )
}

/**
 * One fired criterion: the guard it names and how long it held.
 * @param props.criterion - the narrowed criterion.
 * @param props.t - meteoChat translate seat.
 * @returns the criterion line.
 */
function MeteoCriterionLine({ criterion, t }: {
  criterion: MeteoCriterionMeta
  t: MeteoT
}) {
  return (
    <div className={css.criterion}>
      {criterion.disaster} {criterion.element}{criterion.op}{String(criterion.value)}{' '}
      <span className={css.criterionMuted}>
        {criterion.level} · {t('consult.criterion.held', { hours: String(criterion.hoursHeld), time: criterion.firstTime })}
      </span>
    </div>
  )
}

/**
 * The per-day suitability judgements, present only when any exist.
 * @param props.days - the narrowed days.
 * @param props.t - meteoChat translate seat.
 * @returns the section, or null.
 */
function MeteoSuitabilitySection({ days, t }: { days: readonly MeteoSuitabilityDayMeta[]; t: MeteoT }) {
  if (days.length === 0) return null
  return (
    <section className={css.section} aria-label={t('consult.findings.suitability')}>
      <div className={css.sectionTitle}>{t('consult.findings.suitability')}</div>
      {days.map(day => (
        <div className={css.section} key={`${day.day}-${day.activity}`}>
          <div className={css.dayLine}>
            <span className={css.dayScope}>{day.day} · {day.crop}/{day.activity}</span>
            <span className={css.verdict} data-verdict={VERDICT_KEYS[day.verdict] === undefined ? 'unknown' : day.verdict}>
              {verdictText(day.verdict, t)}
            </span>
          </div>
          {day.criteria.map((criterion, index) => (
            <MeteoCriterionLine key={`${criterion.element}-${index}`} criterion={criterion} t={t} />
          ))}
        </div>
      ))}
    </section>
  )
}

/**
 * The hazard reading: the level word and every criterion that held, or the
 * quiet note when none did.
 * @param props.hazard - the narrowed hazard reading.
 * @param props.t - meteoChat translate seat.
 * @returns the hazard section.
 */
function MeteoHazardSection({ hazard, t }: {
  hazard: MeteoConsultMeta['results']['hazard']
  t: MeteoT
}) {
  const tone = hazard.level === 'low' || hazard.level === 'medium' || hazard.level === 'high'
    ? hazard.level
    : 'unknown'
  return (
    <section className={css.section} aria-label={t('consult.findings.hazard')}>
      <div className={css.sectionTitle}>{t('consult.findings.hazard')}</div>
      <div className={css.findingRow}>
        <span className={css.hazardLevel} data-level={tone}>{hazard.level}</span>
        {hazard.basis.length === 0 ? (
          <span className={css.criterionMuted}>{t('consult.hazard.none')}</span>
        ) : null}
      </div>
      {hazard.basis.map((criterion, index) => (
        <MeteoCriterionLine key={`${criterion.element}-${index}`} criterion={criterion} t={t} />
      ))}
    </section>
  )
}

/**
 * The station the consultation actually read.
 * @param props.station - the resolved station identity.
 * @param props.t - meteoChat translate seat.
 * @returns the station section.
 */
function MeteoStationSection({ station, t }: {
  station: NonNullable<MeteoConsultMeta['resolvedStation']>
  t: MeteoT
}) {
  return (
    <section className={css.section} aria-label={t('consult.findings.station')}>
      <div className={css.sectionTitle}>{t('consult.findings.station')}</div>
      <div className={css.findingRow}>
        <span className={css.findingValue}>
          {station.name} <span className={css.stationId}>({station.id})</span> — {station.county} {station.township}
        </span>
      </div>
    </section>
  )
}

/**
 * The retrieved chunks, each with its ordinal, heading trail, and capped
 * excerpt, plus the truncation note when the window filled.
 * @param props.citations - the narrowed chunk list.
 * @param props.truncated - whether more chunks may exist.
 * @param props.t - meteoChat translate seat.
 * @returns the citations section, or null when nothing was retrieved.
 */
function MeteoCitationsSection({ citations, truncated, t }: {
  citations: MeteoConsultMeta['citations']
  truncated: boolean
  t: MeteoT
}) {
  if (citations.length === 0 && !truncated) return null
  return (
    <section className={css.section} aria-label={t('consult.findings.citations')}>
      <div className={css.sectionTitle}>{t('consult.findings.citations')}</div>
      {citations.map((citation, index) => (
        <div className={css.citation} key={`${citation.docId}-${citation.ordinal}`}>
          <div className={css.citationHead}>
            <span className={css.citationIndex}>{String(index + 1)}.</span>
            <span className={css.citationTitle}>{citation.docTitle}</span>
            <span className={css.citationMeta}>
              {t('consult.citation.chunk', { n: String(citation.ordinal) })}
              {citation.headingPath === '' ? '' : ` · ${citation.headingPath}`}
            </span>
          </div>
          <p className={css.snippet}>{citation.snippet}</p>
        </div>
      ))}
      {truncated ? <div className={css.truncatedNote}>{t('consult.findings.truncated')}</div> : null}
    </section>
  )
}

/**
 * The clarification question: why the consultation stopped before reading
 * data and the stations it offers as the likely meaning.
 * @param props.clarification - the narrowed clarification.
 * @param props.t - meteoChat translate seat.
 * @returns the question block.
 */
function MeteoClarificationBlock({ clarification, t }: {
  clarification: MeteoClarificationMeta
  t: MeteoT
}) {
  return (
    <section className={css.question} aria-label={t('consult.clarification.title')}>
      <div className={css.questionTitle}>{t('consult.clarification.title')}</div>
      <p className={css.questionReason}>{t(CLARIFICATION_KEYS[clarification.reason])}</p>
      {clarification.candidates.length > 0 ? (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('consult.clarification.candidates')}</div>
          {clarification.candidates.map(candidate => (
            <div className={css.candidate} key={candidate.id}>
              {candidate.name} <span className={css.candidateId}>({candidate.id})</span> — {candidate.county} {candidate.township}
            </div>
          ))}
        </div>
      ) : (
        <p className={css.questionReason}>{t('consult.clarification.none')}</p>
      )}
    </section>
  )
}

/**
 * The expanded card: the step trace, then the clarification question or the
 * per-step findings, then the citation list last.
 * @param props.meta - the narrowed consultation metadata.
 * @param props.t - meteoChat translate seat.
 * @returns the card body.
 */
export function MeteoConsultBody({ meta, t }: { meta: MeteoConsultMeta; t: MeteoT }) {
  return (
    <>
      <MeteoStepsSection steps={meta.steps} t={t} />
      {meta.needsClarification !== undefined ? (
        <MeteoClarificationBlock clarification={meta.needsClarification} t={t} />
      ) : (
        <>
          {meta.resolvedStation !== undefined ? (
            <MeteoStationSection station={meta.resolvedStation} t={t} />
          ) : null}
          <MeteoSeriesSection title="consult.findings.observations" rows={meta.results.observation} t={t} />
          <MeteoSeriesSection title="consult.findings.forecast" rows={meta.results.forecast} t={t} />
          <MeteoSuitabilitySection days={meta.results.suitability} t={t} />
          <MeteoHazardSection hazard={meta.results.hazard} t={t} />
          <MeteoCitationsSection citations={meta.citations} truncated={meta.truncated} t={t} />
        </>
      )}
    </>
  )
}

/**
 * Render one `meteo_consult` call as the step-trace card.
 * @param props - keyed toolview payload plus the meteoChat locale seat.
 * @returns the dedicated consultation row.
 */
export function MeteoConsultCard({ block, inspect, t }: MeteoConsultCardProps) {
  const model = meteoConsultModel(block)
  const argsText = model.state === 'running' || model.meta !== null ? null : meteoCallArgsFormatted(block)
  const expandable = model.state !== 'running' && (model.meta !== null || model.output !== null || argsText !== null)
  const { open, toggle } = useDisclosure(expandable)
  const status = stateStatus(model.state, STATE_KEYS, t)
  const summary = model.state === 'error'
    ? model.errorSummary ?? ''
    : model.question ?? ''
  const leading = disclosureLeading(model.state, open, expandable, <IconDataOutlineRegular size={14} />)
  return (
    <div className={css.card} data-tool="meteo_consult" data-state={model.state}>
      <div
        className={css.row}
        data-expandable={expandable || undefined}
        {...disclosureProps(open, expandable, toggle)}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null ? <span className={css.visuallyHidden}>{status}</span> : null}
        <span className={css.title}>{t('consult.title')}</span>
        <span className={css.separator} aria-hidden />
        <span className={model.state === 'error' ? `${css.summary} ${css.errorSummary}` : css.summary}>
          {summary}
        </span>
      </div>
      {open ? (
        <div className={css.bodyWrap}>
          {model.state === 'ok' && model.meta !== null
            ? <MeteoConsultBody meta={model.meta} t={t} />
            : <MeteoGenericBody argsText={argsText} output={model.output} error={model.state === 'error'} t={t} />}
          <MeteoInspectButton inspect={inspect} t={t} />
        </div>
      ) : null}
    </div>
  )
}

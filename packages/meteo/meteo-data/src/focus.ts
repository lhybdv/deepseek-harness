/**
 * The session's meteorological focus: one whole-value event, the projection
 * that folds it, and the two functions a consultation tool uses to read and
 * write it.
 *
 * A consultation spans turns. The first turn settles which station and which
 * crop a farmer means; every later turn — and every tool call inside it — has
 * to answer about that same place. The focus is where that decision survives: a
 * single `meteo/focus` event per change, holding the whole new value rather than
 * a delta, so replaying a log from `init` needs no history of what came before.
 *
 * The projection is host-only: the focus is a tool-side anchor, not a client
 * surface, so it is checkpointed like every other unit but never appears in a
 * client snapshot.
 *
 * @module @deepseek-ai/dsh-meteo-data/focus
 */

import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { FocusSnapshot } from './types.ts'

/** One write of the focus: the complete value the session now holds. */
export interface MeteoFocusEvent {
  /** Event discriminator, mirrored in the payload so a log reader can identify the domain without the type table. */
  readonly kind: 'meteo/focus'
  /** Payload revision; one whole-value record shape today. */
  readonly version: 1
  /** The complete focus, or `null` when the session is no longer about one place. */
  readonly focus: FocusSnapshot | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The place and crop a meteorological consultation is working on, written
     * whole by whichever turn last settled it. The payload is the complete
     * snapshot the session now holds rather than a delta: an optional station
     * id, an optional crop, and the millisecond instant the turn recorded them,
     * or `null` when the session has stopped being about one place. A later turn
     * reads the value carried by the last such write, so a turn that changes only
     * the crop still names the station it means.
     */
    'meteo/focus': MeteoFocusEvent
  }
}

const focusSnapshotSchema = z.object({
  stationId: z.string().min(1).optional(),
  crop: z.string().min(1).optional(),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()

const focusStateSchema = z.union([z.null(), focusSnapshotSchema]) as unknown as z.ZodType<FocusSnapshot | null>

/** Fold of the focus a session's log last wrote. */
export const meteoFocusProjectionDefinition = {
  key: 'meteoFocus',
  stateSchema: focusStateSchema,
  init: () => null,
  apply: (state, event) => event.type === 'meteo/focus' ? event.data.focus : state,
  stateVersion: 1,
} satisfies ProjectionDefinition<'meteoFocus', FocusSnapshot | null>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    meteoFocus: FocusSnapshot | null
  }
}

/**
 * Read what this agent's session is currently about.
 *
 * The projection is the only read path: a tool never re-parses the log, and a
 * session whose log carries no `meteo/focus` event simply has no focus yet.
 * @param ctx - context that carries the session projection registry this package registers into.
 * @param agent - the agent whose session holds the focus; anything with its `session` will do.
 * @returns the last written focus, or `null` when the session has none.
 */
export function readFocus(ctx: Context, agent: Pick<Agent, 'session'>): FocusSnapshot | null {
  return ctx.sessionProjections.stateOf(agent.session, 'meteoFocus') ?? null
}

/**
 * Record what this session is now about.
 *
 * Whole-value and append-only: writing replaces the focus for every later read
 * without touching earlier events, and `null` is the way to say the session is
 * no longer anchored to a place.
 * @param session - session whose log records the change.
 * @param focus - the complete focus, or `null` to release it.
 */
export function appendFocus(session: Session, focus: FocusSnapshot | null): void {
  session.append('meteo/focus', { kind: 'meteo/focus', version: 1, focus })
}

/**
 * The onboarding switch shared by both faces of this package.
 *
 * The switch is a deployment choice, so it is a validated `Config` field on the
 * Host Loader row. A browser cannot read a Loader row, so the Host half projects
 * the field into this `globalThis` name and the Client half reads it back; the
 * Models settings section is registered either way.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-models/onboarding-switch
 */

/** `globalThis` property carrying the resolved onboarding switch into the browser. */
export const ONBOARDING_GLOBAL = '__DSH_SETTINGS_ONBOARDING__'

/** Deployment default: the first-run onboarding dialogs are registered. */
export const DEFAULT_ONBOARDING = true

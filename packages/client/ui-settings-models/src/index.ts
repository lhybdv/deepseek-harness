/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_ONBOARDING, ONBOARDING_GLOBAL } from './onboarding-switch.ts'

export { DEFAULT_ONBOARDING, ONBOARDING_GLOBAL } from './onboarding-switch.ts'

/** Deployment configuration for the Models settings surface. */
export interface Config {
  /**
   * Register the first-run onboarding dialogs (the welcome notice and the
   * DeepSeek credential step). `false` removes both popups and leaves the
   * Models settings page in place — the two live in one Client plugin, so
   * disabling that plugin would take the page with them.
   */
  onboarding?: boolean
}

/** Validated deployment configuration. */
export const Config: z<Config> = z.object({
  onboarding: z.boolean().default(DEFAULT_ONBOARDING),
})

/**
 * Project the onboarding switch into the served index so the Client half can
 * read it: one `globalThis` assignment ahead of the module scripts, the same
 * channel the connection plugin uses for its recovery timing.
 * @param ctx - Host context that may acquire the webserver.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config = Config({})): void {
  const onboarding = config.onboarding ?? DEFAULT_ONBOARDING
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: ONBOARDING_GLOBAL, value: onboarding })
  })
}

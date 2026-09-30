/**
 * Host plugin body for the meteorology bundle.
 *
 * A bundle is a distribution format for Cordis config rows, not a plugin: every
 * capability this deployment adds is named by `cordis.patch.yml` and mounted by
 * the Loader. This entry exists so the package has the same shape as every other
 * bundle, and it deliberately does nothing.
 *
 * @module @deepseek-ai/dsh-meteo-app
 */

/** Host plugin body — a bundle contributes configuration, never behavior. */
export function apply(): void {}

# Agent Note: An unresolved plugin package identity is reported and omitted, not fatal

Status: implemented

English | [中文](2026-10-02-unresolved-plugin-package-omission.zh.md)

## Problem

`dsh-plugin-package-inventory-deepseek` resolves the npm identity of every active Loader entry from the entry's tree base, the optional `ctx.pluginPackages` service, the host base URL, and its own module URL. The meteo demonstration composes eight workspace packages (for example `@deepseek-ai/dsh-meteo-corpus`) that the Loader reaches through the source plane — tsx with tsconfig `paths` into the workspace — while the profile install tree contains no `node_modules` at all. Every one of those entries resolved to no manifest, the resolver threw, and the DeepSeek adapter reports any extension preparation failure as `REQUEST_EXTENSION: DeepSeek request extension preparation failed`. Every model request in that composition failed, and the message named no package.

## Decision

An active entry whose bare package name resolves to no manifest contributes no package identity: the resolver reports the package name once through the plugin logger and omits the entry, exactly as it already omits a loose module without an owning manifest. A manifest that resolves but declares malformed metadata stays fatal, as do field collision and acceptance logging.

## Rationale

The Loader tolerates the same condition: an entry it cannot resolve is a warning, because a source-plane launch legitimately reaches packages the artifact plane does not index, and misconfigured entries must not prevent the rest of the composition from starting. Failing request preparation for one such entry therefore made two subsystems contradict each other, and the inventory is diagnostic metadata — its purpose is to tell a provider engineer which package versions produced a request, not to gate the request. The [earlier decision](2026-08-21-deepseek-llm-api-request-extensions.md) rejected *silent* dropping of metadata, and a logged report keeps the omission observable, so its intent survives while its consequence (one unresolvable name denies every turn) does not.

## Alternatives considered

**Keep the throw.** Rejected: on a source-plane launch the condition is structural rather than a misconfiguration, the failure names no package in any user-visible surface, and it denies every turn of an otherwise working composition.

**Drop the entry silently.** Rejected: the earlier decision's rejection of silent dropping still holds; the logger report is one line per active entry per process.

**Resolve identities through the Loader's own mapping.** Rejected here: the inventory deliberately samples the authoritative runtime resolution service so its identities match the imports, and teaching it the Loader's source-plane mappings would duplicate Loader internals in a plugin.

## Consequences

The `dsh_plugin_packages` field omits entries whose package manifest does not resolve, and each such active entry produces one warning naming the package. The meteo demonstration no longer disables the contribution. Tests pin the field contents and the single report per entry instead of the previous rejection.

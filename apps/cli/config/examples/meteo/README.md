# Meteorology demonstration overlay

English | [中文](README.zh.md)

A `--patch` overlay that adds the meteorology consultation surface to the shipped
Web composition. It exists so the demonstration runs from a source checkout
without a published data bundle, and so the consultation skills travel with the
demonstration rather than with a package.

## Run it

```sh
pnpm run build
pnpm dsh web --patch ./apps/cli/config/examples/meteo/cordis.yml
```

Open the URL the launcher prints, **including its token**, at `http://127.0.0.1`.

Run from the repository root: two values below are resolved against the process
working directory, because the demonstration fixtures and skills live in the
repository and are deliberately not published with their packages.

## What it adds

| Row | Why |
|---|---|
| `meteo-corpus` | The corpus seam and its SQLite FTS5 index, at `<DSH_HOME>/meteo/corpus.v1.sqlite`. |
| `meteo-data` | The data seam, reading `packages/meteo/meteo-data/fixtures`. |
| `tool-corpus` | `corpus_ingest` / `corpus_search` / `corpus_read`. |
| `tool-meteo` | `meteo_consult` / `meteo_station_lookup` / `meteo_set_focus`. |
| `meteo-controller` | The `meteo` Remote namespace the browser panels call. |
| `ui-meteo`, `ui-meteo-chat` | The corpus page and the conversation cards. |
| `skill-filesystem` (patched) | Points `customSkillDirs` at `./skills`, and `tool-skill` is enabled so the agent can load them. |

The shipped `web` profile already provides the model adapter, the tool registry,
the session log, and the browser application; this overlay adds only the
meteorology rows.

## Deployment differences

Swapping this overlay for the published bundle is a profile change, not a code
change: add `@deepseek-ai/dsh-meteo-app` to the profile's bundle list and publish
a data bundle where its `meteo-data.fixtureDir` points. See
[`packages/bundle/meteo-app`](../../../../../packages/bundle/meteo-app/README.md).

## Skills

`skills/` holds the consultation guidance the agent loads on demand:

- `meteo-query-normalize` — how to turn a colloquial question into the slots the
  tools take, and when to ask instead of guessing.
- `meteo-consult-protocol` — the order to read a consultation result in, and how
  to separate what the data supports from what it does not.
- `meteo-citation-policy` — when a conclusion must cite a corpus chunk and what a
  citation must identify.

They carry procedure and wording only. Every numeric threshold, crop criterion,
classification label, and template lives in the deployment's versioned data, so
changing a threshold changes the answer without editing a skill.

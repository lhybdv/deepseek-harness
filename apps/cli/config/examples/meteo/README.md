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
## Demo data

The fixture bundle publishes 33 stations: eight township stations each in Wuchang City, Heilongjiang (`hl-wc-*`), Yushu City, Jilin (`jl-ys-*`), and Changtu County, Liaoning (`ln-ct-*`), plus three city stations each in Harbin (Daoli, Songbei, Acheng), Changchun (Chaoyang, Nanguan, Jiutai), and Shenyang (Heping, Shenbei New Area, Liaozhong). The bundle has 33 observation files and 33 forecast files; every station has a 24-row series, with observations from 2026-09-23 00:00 UTC through 23:00 UTC and forecasts from 2026-09-24 00:00 UTC through 2026-09-26 21:00 UTC. It covers maize, soybean, and rice, with spring-drought, low-temperature cold-damage, early-frost, heavy-rain, and waterlogging criteria. The data is fixture-first; it does not connect to a live weather source.


## What it adds

| Row | Why |
|---|---|
| `meteo-corpus` | The corpus seam and its SQLite FTS5 index, at `<DSH_HOME>/meteo/corpus.v1.sqlite`. |
| `meteo-data` | The data seam, reading `packages/meteo/meteo-data/fixtures`. |
| `tool-corpus` | `corpus_ingest` / `corpus_search` / `corpus_read`. |
| `tool-meteo` | `meteo_consult` / `meteo_station_lookup` / `meteo_set_focus`. |
| `meteo-controller` | The `meteo` Remote namespace the browser panels call. |
| `ui-meteo`, `ui-meteo-chat` | The corpus page and the conversation cards. |
| `speech-to-text-rtasr`, `speech-to-text` (patched) | The demonstration's speech recognizer: the Voice Input bundle's cloud row is enabled and selected. |
| `skill-filesystem` (patched) | Points `customSkillDirs` at `./skills`, and `tool-skill` is enabled so the agent can load them. |

The shipped `web` profile already provides the model adapter, the tool registry,
the session log, and the browser application; this overlay adds only the
meteorology rows.

## Voice input

The microphone beside the composer records one question and inserts the
transcript into the draft as ordinary text, so a spoken question reaches the
agent exactly as a typed one does. With this overlay's cloud recognizer
selected, the text also appears while the question is still being spoken and
corrects itself as the service refines each sentence; the settled transcript is
what reaches the draft. Voice input itself travels with the Voice
Input bundle rather than with this overlay: enable it in Plugins. The two rows
below configure that bundle's layer — they stay inert, one Loader warning each,
until it is on — and switch the demonstration to cloud recognition and select it.

The recognizer reads its application id and access key id from
`IFLYTEK_RTASR_APP_ID` and `IFLYTEK_RTASR_ACCESS_KEY_ID`, and its access key
secret from the credential reference `IFLYTEK_RTASR_ACCESS_KEY_SECRET` — set it
through `dsh` credentials, the environment, or the repository `.env`. A missing
value fails that one recording with the field named; the rest of the
demonstration is unaffected, and no credential is read until a recording starts.
The Host must be able to reach
`wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1`; a deployment behind a
proxy points `baseWsUrl` at its own endpoint.

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

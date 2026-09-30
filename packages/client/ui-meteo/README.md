---
description: "Meteorology browser panel for the dsh web client: a global corpus page that indexes, searches, and cites professional material over the meteo Remote namespace, plus a right-Sidebar citation tab that shows one chunk of it."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-meteo

English | [中文](README.zh.md)

## Summary

The meteorology panel — **WindPilot** — in the browser: a global corpus page that indexes, searches, and shows professional material over the `meteo` Remote namespace, plus a right-Sidebar citation tab that opens one chunk of it by address. Both read the `meteo` Remote namespace and nothing else.

## Table of Contents

- [What it registers](#what-it-registers)
- [The corpus page](#the-corpus-page)
- [The citation tab](#the-citation-tab)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The panel row and the page** — `sidebar.panellist` under id `meteo-corpus` at order 30, labelled from the `meteo` namespace and drawn with the shared gauge glyph, and the root-scoped `main` entry under the same key. One id addresses both, so a row can never point at a body that is not there. The id stays `meteo-corpus` because it is the addressing key rather than a label, and the two names are deliberately different: the row carries the panel's **function** (the index of citable material) while the page heading carries the product's **name**, so a reader scanning the panel list learns what the row does rather than what the deployment is called. The page is global rather than session-scoped because the corpus is not session state: it is one index the whole deployment consults.
- **The citation type** — `ctx.sidebarRightTabs.register(...)` with kind `meteo-citation`, id `@deepseek-ai/dsh-client-ui-meteo/citation`, band `builtin`, pattern `dsh-resource://meteo/citation/**`, and one guide entry at order 30. The body is the keyed `sidebar.right.pane.tab` seat under that id. No other registered type claims this scheme, so the definition needs no `canOpen`.

Five source files under `src/client/`: `address.ts` (the citation address), `definition.ts` (the type), `face.ts` (the Remote binding), `CorpusPage.tsx` (the page), `CitationTab.tsx` (the evidence body), `MeteoPanelIcon.tsx` (the panel glyph), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="the-corpus-page"></a>
## The corpus page

Three surfaces over one bound face, each with its own pending state so one call in flight disables only its own control.

| Surface | Gesture | Answer |
|---|---|---|
| Documents | Listed at mount and on **reload** | Title, chunk count, size, source, and ingest time per document, with **inspect chunks** (reading every ordinal on demand) and **remove**. |
| Upload material | Files, chosen in one pick and staged until indexed; **index** stays disabled while nothing is staged | The index's new document list, plus one line per refused source. A document is titled by its file's name **without** the suffix the page decoded it by, because the suffix describes the file rather than the material. The page refuses a file it cannot decode itself — naming the file and the reason — and keeps any source the index refused staged, so the reader fixes it and sends it again rather than finding the file twice. |
| Search | A query; **search** stays disabled while the query is blank | Ranked hits with their heading trail, character range, and excerpt, each with **查看证据**, which reads that chunk back and shows it verbatim under the hit. |

What the page keeps is reading state only: the list, the last ingest's refusals, the last search's query and hits, the chunk last opened, and the failure each surface answered with. Every gesture replaces what the Host answered with rather than patching locally, so a removal the index reports as `removed: false` leaves the list alone — the document was already gone, which is the state the reader wanted.

A removal drops the document and every hit pointing into it, so the search results never offer evidence from a document the page no longer lists.

**Why the evidence is read into the page rather than opened in the right Sidebar.** The right Sidebar's tab seats are session-scoped, and a session surface is mounted only under the conversation — which this panel replaces when it is selected. `ctx.sidebarRight.openResource` therefore throws `no session surface is mounted` from a global panel. The chunk is read through the same namespace that answered the search instead, which works wherever the panel is shown.

<a id="the-citation-tab"></a>
## The citation tab

The `meteo-citation` type is registered for surfaces that do have a session: a citation is a resource address, `dsh-resource://meteo/citation/<docId>/<ordinal>`, and opening it reads that chunk into a right-Sidebar tab. The document id is percent-encoded as one path segment, because an id is opaque text the corpus minted and may contain a `/`; opening the same address twice is the same tab, because the address is the content identity.

The body draws the chunk verbatim under its heading trail and character range — what lets a reader check a conclusion against the passage the model cited. Three answers are told apart: the chunk; `meteo/chunk-not-found`, which is a removal answered rather than retried, so the tab says the citation is gone; and any other failure, reported with its message. An address the type should never have claimed is refused outright instead of being read as some other chunk.

`citationAddress` is exported as the writer of that scheme. Nothing composes it yet: the consultation card that shows the citations exists and registers, but its citation rows do not open this type, and wiring them is deferred work (`## Known Limitations and Deferred Work`).

<a id="model-experience"></a>
## Model Experience

None, as this package draws the corpus page and citation viewer in the browser and registers nothing model-facing.

#### KV Cache effect

None; corpus reads and searches travel over the Remote and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Text files only.** The picker reads `.md`, `.markdown`, `.txt`, `.text`, `.json`, `.csv`, `.log`, `.yaml`, and `.yml` in the browser and refuses anything else by name; `docx`, `pdf`, and spreadsheet formats need a server-side extractor this deployment does not ship, and indexing their bytes as text would be worse than refusing them.
- **The index is global.** Every session sees one corpus, and there is no per-session or per-user separation; the page offers no confirmation before a removal.
- **No reranking or highlighting.** The page shows the hits the index ranked, in its own order, with the excerpt the index capped; the consultation path's reranking is the tool's, not this page's.
- **The citation tab has no opener yet.** The type and its viewer are complete and unit-tested, but the only surface that can open it is the conversation, and the consultation card that would do so is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The citation address is deliberately a resource address rather than a store keyed by tab id: it makes an open idempotent, survives a reload, and needs no side channel between the page and the tab.

</details>

**Runtime invariant:** No companion is published. The page's state is derivable from the namespace's answers, and the tab's state is one chunk read per address; neither observes another plugin's state in a way that could diverge.

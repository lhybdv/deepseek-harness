---
description: "WindPilot brand occupants for the dsh web shell's generic brand seats: the Sidebar's mark and name, and the blank-session hero's mark."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-windpilot

English | [中文](README.zh.md)

## Summary

WindPilot's brand, filling four generic seats the shell declares: the Sidebar's mark and name, the blank-session hero's mark, and the welcome page's team footer. The mark is a cloud drawn in this package, and the name is the wordmark above the platform tagline. Removing this plugin's Loader row is the whole unbranding — the shell's own fish-and-text fallbacks take over, because branding is an occupant rather than a shell behaviour.

## Table of Contents

- [What it registers](#what-it-registers)
- [The mark](#the-mark)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

| Seat | Occupant | Presentation |
|---|---|---|
| `sidebar.brand.mark` | The cloud at the requested edge | Beside the panel list, above the workspace region. |
| `sidebar.brand.name` | The wordmark over the platform tagline | The expanded Sidebar's brand text; the occupant owns its own width. |
| `conversation.hero.brand.mark` | The same cloud at the hero's larger edge | The blank-session hero, where the host also supplies the class that keeps the larger mark's geometry. |
| `conversation.hero.headline` | The brand slogan | The welcome copy beside that mark, replacing the shell's own. |
| `conversation.hero.footer` | The team footer, `风云 AI组` | The blank-session welcome page's bottom edge, below its composer. |
Every string is owned by the `windpilotBrand` namespace. `WindPilot` and the slogan stay as written in both dictionaries because they are the brand's own lines; only the tagline is translated.

All five seats are `single` and root-scoped, and **declared by the shell** — `ui-sidebar` declares the first two and supplies generic fallbacks for them, `ui-conversation` declares the rest with its own welcome copy and a fish fallback. This package only fills them, which is why the brand travels as a plugin instead of as a shell option: composing it out is a `cordis.yml` edit, and the fallbacks are still there.

The hero's **preview badge is not a seat** and is not this package's business: the shell renders it only for its own build (`DSH_CLIENT_BUILD_PROFILE === 'official'`), because it is a claim about the build rather than welcome copy. A deployment that ships its own product therefore shows none.

`src/client/`: `WindPilotMark.tsx` (the drawing), `WindPilotBrand.tsx` (one thin occupant per seat), `locales.ts` (the wordmark, tagline, and the mark's accessible name), and `index.ts` (the wiring).

<a id="the-mark"></a>
## The mark

The cloud is drawn inline, not imported: the shared icon set carries no cloud, and adding one there would ship a new primitive to every client to serve one brand. A brand mark is drawn where it is used, and the seat — not the mark — decides the edge, so the mark itself takes a size and passes a host class through unchanged.

The four occupants exist because the seats disagree about what they pass. The Sidebar's mark asks for an edge and nothing else; the hero adds the class that preserves its larger geometry; the name supplies no content at all; the welcome footer supplies nothing and the occupant owns only its type and quiet colour. Keeping that mapping in the occupants is what lets the mark stay a plain drawing.

Every string is owned by the `windpilotBrand` namespace. `WindPilot` is the same in both dictionaries because it is a proper noun; the tagline is translated.

<a id="model-experience"></a>
## Model Experience

None, as this package draws the brand in the browser and registers nothing model-facing.

#### KV Cache effect

None; the occupants draw on mount and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Sidebar and hero only.** The brand fills the seats the shell declares today. A surface without a brand seat — a document title, a favicon, an email template — is not covered, and covering one means declaring a seat for it rather than reaching into that surface from here.
- **The name slot renders text, not artwork.** The shell's own fallback is a wordmark picture; this occupant renders the wordmark and tagline as type so the tagline can be translated. A deployment needing the artwork as vector paths should register its own occupant.
- **No dark/light variant.** The mark inherits `currentColor`, which is what lets both themes read, but there is no per-theme artwork.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The occupants live in `WindPilotBrand.tsx` and the drawing in `WindPilotMark.tsx` so the drawing stays testable without a seat, which is what the component spec does: it asserts the cloud path, the requested edge, and the class passthrough directly.

</details>

**Runtime invariant:** No companion is published. Every occupant is a pure function of the props its seat supplies, and this plugin holds no state; it observes no other plugin's state in a way that could diverge.

DUEL PRACTICE TABLE — ENGINE SOURCE OFFER (README)
====================================================

What this build contains
------------------------
The "Engine Duel (beta)" view of this page runs a real Yu-Gi-Oh! rules
engine in the browser. The engine is the Project Ignis duel core
(ocgcore, the EDOPro core from edo9300/ygopro-core), compiled to
WebAssembly via ocgcore-wasm 0.1.4 (n1xx1/ocgcore-wasm, npm). Card
effects resolve from the ProjectIgnis/CardScripts Lua corpus. Those
components are free software under the GNU Affero General Public
License, version 3 or later (AGPLv3-or-later). This project's own
integration code — the engine worker (assets/engine-worker.js) and
the engine UI module inside this page — is offered under
AGPLv3-or-later alongside them.

Pinned versions
---------------
- Engine core: Project Ignis ocgcore, upstream repository
  https://github.com/edo9300/ygopro-core — compiled and packaged as
  ocgcore-wasm 0.1.4 (npm, by n1xx1:
  https://github.com/n1xx1/ocgcore-wasm). The compiled binary and its
  JavaScript glue are served from assets/ocgcore/ on this site.
- Card scripts: ProjectIgnis/CardScripts @ commit
  3b3a66f685e4c1d0d82214550e56f54c001cc30c, upstream repository
  https://github.com/ProjectIgnis/CardScripts.

How the corpus chunks were produced
-----------------------------------
The files under assets/corpus/ are a mechanical re-packaging of the
upstream Lua scripts: the corpus (official, pre-release, unofficial,
pre-errata, goat, rush and skill scripts) was merged by card passcode
with official scripts taking priority, then split into gzipped JSON
chunks (pack-0000.json.gz through pack-0186.json.gz) grouped by
passcode range, so the page downloads only the chunks a selected deck
actually needs. No script logic was rewritten by this re-packaging.
assets/corpus/pack-manifest.json.gz enumerates every chunk, the
passcodes it contains, and the pack totals (22,554 scripts in 187
chunks). The preload subset, assets/engine-scripts.json.gz, holds
the scripts for the original 16 preloaded decks in the same format and is not
duplicated in the corpus pack. assets/engine-cardmeta.json.gz is
this project's card metadata index used by the engine UI.

How the card data is packaged
------------------------------
The card database previously shipped as one file,
assets/card-db.js (5,649,493 bytes). It now ships split, the same
way as the corpus pack:

- assets/card-index.js (979,426 bytes) — the light index:
  passcode, name, type, level/rank/link, ATK/DEF, race, attribute,
  Pendulum scales, link markers and material count for all 14,759
  cards. This is the only card data loaded at startup.
- assets/card-details.js — this project's loader: it fetches the
  manifest and, on demand, only the detail chunk a viewed or
  played card lives in, verifies the chunk's SHA-256 against the
  manifest, and merges the text into the index rows.
- assets/card-details/manifest.json.gz (57,651 bytes) — enumerates
  all 27 detail chunks, the passcodes each contains, and each
  chunk's SHA-256.
- assets/card-details/detail-0000.json.gz through
  detail-0026.json.gz (1,046,802 bytes gz in total) — the full
  effect text (desc) for all 14,759 cards, in gzipped JSON chunks
  grouped by passcode range.

The split is a mechanical re-packaging: the union of the index and
the chunks reproduces the former card-db.js content exactly, card
for card and field for field. No card-data file is omitted from
this offer — the index, the loader, the manifest and all 27 chunks
are served at the paths above. The only binary this site serves
without local source remains the compiled engine core
(assets/ocgcore/*.wasm), whose Corresponding Source is the upstream
core repository named above.

Where the Corresponding Source lives
------------------------------------
- The in-page source panel — "Engine source code & licenses
  (AGPLv3)", linked from the Home view and from the Engine Duel
  view — lists every component with its role, license, upstream
  origin, and a download link to the exact bytes hosted on this
  site. This page's own full source is downloadable there too
  (assets/source/index-source.html, a byte copy of the shipped
  index.html; the page is also served unminified).
- A public GitHub mirror of the source is planned but not yet
  live. Until it is, this page itself is the source home: the
  complete Corresponding Source is downloadable from the in-page
  source panel and the downloads listed in this notice.

The compiled WebAssembly binary (assets/ocgcore/ocgcore.sync*.wasm)
is a build artifact of the upstream core; its Corresponding Source
is the upstream core repository named above. This site serves the
binary and its glue for download and points to that upstream source
rather than claiming to host a rewritten core.

Typography
----------
Rajdhani (© Indian Type Foundry) and Inter (© The Inter Project
Authors) are self-hosted from assets/fonts/ and are licensed under
the SIL Open Font License 1.1. Their license texts ship beside the
font files as assets/fonts/OFL-Rajdhani.txt and
assets/fonts/OFL-Inter.txt. The page makes no external font requests.

License text
------------
The full GNU AGPLv3 text ships with the corpus pack at
assets/corpus/COPYING.txt and is linked from the source panel.

Member art — Hall of Champions
-------------------------------
The framed member art on the Home page (assets/art/*.webp) is drawn
from ONE delimited data block in index.html: search for
"FN_MEMBER_ART" (the block headed "MEMBER ART — HALL OF CHAMPIONS").
Each entry carries the member's display name, the plaque/role line,
the credit line, the image path, alt text, and a layout slot
('feature' / 'featureSide' / 'row' / 'court').

To add a new piece of fan art: crop any phone/Discord chrome, resize
to at most ~1000px on the long edge, save as WebP under assets/art/,
and add one entry to the block — the Hall re-renders from the list,
plaques and spotlight included. To remove a piece (e.g. at the
member's request), delete its entry and the file. The posters are
credited "Poster by Karlie Sophia"; portraits are credited as the
member's own avatar art. Member art appears only inside frames in
the Hall — never as a page background.

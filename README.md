# Welcome to the Table — a Fire Nation handoff guide

**For Zuko and Karlie, from DrunkenDraco.**

## What this is

This is the Duel Practice Table — the Fire Nation's own practice hall. It runs
real Yu-Gi-Oh! duels on a real rules engine, holds the Nation's decks and
guides, and wears the Nation's art on its front wall, the Hall of Champions.

It used to live inside DrunkenDraco's Muse, where only he could change it.
Now it lives here, in this GitHub repo, so the Nation can change it as it
likes. This page is everything you need to do that — no programming background
required for the everyday changes.

## Who holds the keys

- **Owner: DrunkenDraco** (GitHub: `vwilson4`). He keeps full ownership,
  always — if the Nation ever wants him to run the table again, he can, just
  like that.
- **Collaborators with write access: FireLordZuko and Karlie Sophia.** You can
  edit anything in this repo, any time, without asking anyone.
- Everyone else: the site itself is public to play, and this code is shared
  under the AGPL license (the table's engine is a community open-source core;
  sharing is the deal we proudly keep).

## How the site updates: push = publish

The site is served by **GitHub Pages** straight from this repo.

- You edit a file → you save it ("commit") → GitHub republishes the site
  automatically, usually within a minute or two.
- There is no separate "deploy" step and no server to babysit.
- You can edit files right on this website: open a file, click the pencil
  icon, make your change, scroll down, write a one-line note about what you
  changed, and commit. That's the whole trick.
- Golden rule: **one small change at a time.** Small changes are easy to
  check and easy to undo. Big all-at-once changes are how pages break.

## Change the Hall of Champions art

The Hall — the framed wall on the home page — is driven by one small list
inside `index.html` called **FN_MEMBER_ART**. Search the file for
`FN_MEMBER_ART` and you'll find entries that look like this (this one is real):

```js
{ member: 'Kiwi', role: '1st Place Champion — DoomZ · October 2026 Genesys Tournament', credit: 'Poster by Karlie Sophia', img: 'assets/art/kiwi-champion-poster.webp', alt: "Karlie Sophia's poster of Kiwi, 1st Place Champion, over his DoomZ monsters", slot: 'hero', side: 'right', kiwi: true },
```

What each part means:

- `member` — the name on the plaque.
- `role` — the line under the name (title, placing, deck).
- `credit` — **who made the art. Always credit the artist.** Posters Karlie
  makes say `Poster by Karlie Sophia`; a member's own avatar art says so too.
- `img` — the picture file. Pictures live in the `assets/art/` folder.
- `alt` — a one-sentence description of the picture (helps screen readers).
- `slot` — `'hero'` puts a frame in the big top row; `'row'` puts it in the
  champions row below. On a hero entry, `center: true` is the emperor's
  center frame (that's Zuko's), and `side: 'left'` / `side: 'right'` pick the
  flanking frames.
- `kiwi: true` — Kiwi's entries only; it gives his frames the little green
  kiwi-flame accent.

**To put up a new piece:** add the picture file to `assets/art/` (WebP format
is best — the current posters are roughly 150–230 KB, portraits 20–30 KB;
huge phone photos should be shrunk first), copy an existing entry, and change
its words and `img` path to yours. Keep the commas and brackets exactly as
they are — the list is picky about punctuation, like a duel judge.

**To take a piece down:** delete its entry (and the file in `assets/art/` if
you like). 

**The honor rule, and it is not optional:** every piece on that wall belongs
to a member of this Nation. Credit them by name, always. And if any member
ever asks for their art to come down — any reason, no debate — it comes down
in the next edit. That's the deal the wall was built on.

## Edit the Meta Heartbeat (the "Techs & Testing" strip)

The heartbeat is the dated news/tech strip on the home page. Its stories are
**not** in a data file — each story is a small block of page text inside
`index.html`. Search for `data-hb-slide` and you'll find the stories, one
after another, each shaped like this:

```html
<article class="hb-slide" data-hb-slide>
  <div class="hb-num" aria-hidden="true">01</div>
  <div>
    <span class="hb-family">Techs of the week · Elfnote</span>
    <h4>The tuner rule: Imperm the raise, not Medius</h4>
    <p>If you hold Imperm against the Portal opener, you spend it on the Level 1 Power Patron's level-raise — not Medius.</p>
    <p class="hb-source">Source: Fire Nation Elfnote cheat sheets · Updated Oct 17, 2026.</p>
  </div>
</article>
```

- Copy a whole `<article>…</article>` block to add a story; change the words.
- Keep the family's honesty rule: **every number gets a date and a source**
  in the `hb-source` line. If we can't source it, it doesn't go on the strip.
- Renumber the `hb-num` values so they run in order (01, 02, 03…), and the
  little "1 / 7" counter on the page updates itself.

## Add a preloaded deck

Preloaded decks live in `index.html` too, in a big list called **DECKS**.
Each deck is one entry shaped like this (shortened — real ones are longer):

```js
"my-new-deck": { "name": "My New Deck — who played it, where", "fmt": "md",
  "main": ["14558127", "14558127", "14558127", "..."],
  "extra": ["56910167", "..."],
  "corpus": true, "cards": {} },
```

- The numbers are **card passcodes** — the 8-digit number printed on every
  real Yu-Gi-Oh! card (and shown in Master Duel). Three copies of a card =
  the number three times.
- `"fmt"` is `"md"` for a Master Duel list or `"tcg"` for a paper list.
- `"corpus": true, "cards": {}` — leave these exactly as they are; they tell
  the table to look the cards up in its full card database.
- The honest warning: decks are the fiddliest thing on the table. A wrong
  number won't break the page, but the deck will be wrong. Copy an existing
  entry and swap its lists rather than typing one from scratch — and for a
  big new deck, it's still perfectly fine to hand the list to DrunkenDraco
  and let him run it through his deck-checking tools first.

## Undo anything: git history is the way back

Every saved change ("commit") is kept forever. Nothing is ever truly broken,
because every earlier version still exists.

- On this repo's page, click **Commits** (the clock-like icon / history list)
  to see every change ever made, newest first.
- Open the change that went wrong, and GitHub offers a **Revert** button —
  that creates a new commit that undoes it, and the site republishes the
  fixed version on its own.
- Or just ask DrunkenDraco. Rolling back is the table's oldest house rule:
  every change ships with its way back.

## If something looks wrong after an edit

1. Give it two minutes — republishing isn't instant.
2. Hard-refresh the page (on a phone, close and reopen the tab).
3. If it's still wrong, revert the last commit (above). Calm, quick, done.
4. If the duel engine itself ever misbehaves after a text-only edit — it
   shouldn't; text edits don't touch the engine — revert anyway and tell
   DrunkenDraco what you changed.

## What not to feed the fire

- Don't rename or move files in `assets/` — the page finds everything by
  exact path. Adding new files is fine; renaming old ones breaks links.
- Don't delete the `assets/source/` folder — that's the table's public
  source-code offer (our AGPL promise), and the page links to it.
- The big `.json.gz` and `.wasm` files are the card database and the duel
  engine. You never need to edit them by hand. Leave them be.

---

*Draft written Oct 19, 2026, at the handoff. Built by DrunkenDraco as a
thank-you gift to this Nation — now it belongs to the Nation.*

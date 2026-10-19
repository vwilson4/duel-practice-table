/* Duel Practice Table — engine worker (Slice E1 spike).
   Runs the Project Ignis ocgcore (edo9300/ygopro-core, AGPLv3-or-later) compiled
   to WebAssembly via ocgcore-wasm 0.1.4 (pinned; sync variant only), in a Web
   Worker. The UI thread owns all data (bundled card DB rows, alias/setcode
   metadata, and the CardScripts corpus index) and posts it here; this worker
   owns duel state and the process loop, and answers the core's decision
   prompts by posting them to the UI and waiting for a response message.
   Script resolution is corpus-general: passcode -> corpus index -> source,
   with alias fallback from the card metadata — identical for preload decks
   and any future imported deck. Slice E2: the index starts as the preload
   subset (engine-scripts.json.gz) and grows by 'addScripts' merges when the
   UI fetches full-corpus pack chunks (assets/corpus/) for imported decks;
   the lookup path itself never changes. */
import createCore from './ocgcore/index.js';

const LOC = { DECK: 1, HAND: 2, MZONE: 4, SZONE: 8, GRAVE: 16, REMOVED: 32, EXTRA: 64, FZONE: 256 };
const QFLAGS = 1 | 2 | 8 | 16 | 32 | 256 | 512 | 65536; // CODE|POSITION|TYPE|LEVEL|RANK|ATTACK|DEFENSE|OVERLAY_CARD
const SELECT_TYPES = new Set([10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 132, 140, 141, 142, 143]);

let lib = null;
let handle = null;
let cardByCode = new Map();
let aliasOf = new Map();
let scriptIndex = null;
let lastPrompt = null;
let duelOver = false;

function buildCardData(pack, meta) {
  cardByCode = new Map();
  aliasOf = new Map();
  for (const r of pack) {
    const code = r[0];
    const m = meta[code] || [0, []];
    if (m[0]) aliasOf.set(code, m[0]);
    cardByCode.set(code, {
      code, alias: m[0] || 0, setcodes: m[1] || [],
      type: r[2], level: r[3], attribute: r[7] || 0,
      race: BigInt(r[6] || 0), attack: r[4] || 0, defense: r[5] || 0,
      lscale: r[8] || 0, rscale: r[9] || 0, link_marker: r[10] || 0,
    });
  }
  /* Alias completion: a passcode registered in the card metadata as an alias
     of another card, but carrying no data row of its own, resolves to its
     alias target's data — the same treatment a cdb alias row gets (the
     Tanks preloads' Jizukiru file passcode #15668122 is registered as an
     alias of the real printing #63941210, which carries the card's data).
     Without this the core finds no data and no script for such a passcode,
     stubs its initial_effect, and the card plays as a data-less body. */
  for (const codeStr of Object.keys(meta)) {
    const code = Number(codeStr);
    if (cardByCode.has(code)) continue;
    const m = meta[codeStr];
    if (m && m[0] && cardByCode.has(m[0])) {
      const t = cardByCode.get(m[0]);
      aliasOf.set(code, m[0]);
      cardByCode.set(code, {
        code, alias: m[0], setcodes: (m[1] && m[1].length) ? m[1] : t.setcodes,
        type: t.type, level: t.level, attribute: t.attribute,
        race: t.race, attack: t.attack, defense: t.defense,
        lscale: t.lscale, rscale: t.rscale, link_marker: t.link_marker,
      });
    }
  }
}

function cardReader(code) {
  return cardByCode.get(code) || null;
}

function scriptReader(name) {
  const base = String(name).split('/').pop();
  const m = base.match(/^c(\d+)\.lua$/);
  if (m) {
    const code = Number(m[1]);
    if (scriptIndex.cards[code]) return scriptIndex.cards[code];
    const al = aliasOf.get(code);
    if (al && scriptIndex.cards[al]) return scriptIndex.cards[al];
    return null;
  }
  return scriptIndex.util[base] || null;
}

const s32 = v => (v > 2147483647 ? v - 4294967296 : v);

/* Field snapshots are RENDERING data only. A failed query must never kill
   the duel process loop, so every query is guarded and falls back to the
   last good snapshot, with the recovery surfaced in the duel log via
   core-print.

   Slice E2 hardening — root cause of the "eof" recoveries and of gutted
   zone cells, pinned down by driving the pinned wrapper in Node against
   real duels: ocgcore-wasm 0.1.4's duelQueryLocation parser corrupts any
   response requested WITH the QUERY_TYPE flag (8). Depending on the card
   states present it either throws "eof" (first reproduced on a Ryzeal
   Graveyard; also Elfnote Monster Zones — hundreds of throws per duel,
   and a plain retry with the same flags always throws again) or, worse,
   returns rows silently stripped of code/position/level (a face-up
   Timelord and a face-down Set trap both came back as code-less rows,
   which the UI then rendered as "Card #0" in the wrong cell). The
   identical query minus the TYPE flag parses cleanly in every observed
   state and returns every other field (code, position, level, rank, ATK,
   DEF, overlay materials). So the primary query omits TYPE and fills the
   type from the bundled card metadata by passcode (a card's printed type
   never changes mid-duel, and the UI only reads type to tell Xyz monsters
   apart for the "Rk" label). If that ever throws, a minimal
   CODE|POSITION query follows (remaining fields filled from the same
   metadata — printed values, rendering-only), and only if both fail does
   the location fall back to its previous contents. Degraded-tier results
   are CURRENT data, so they render silently; the recovery print fires
   only when previous (stale) contents are actually substituted, and only
   on the transition into that state per location, not on every snapshot
   (pre-E2 this printed on every batch — 50+ times in a single duel). */
let lastField = null;
const QFLAGS_NOTYPE = 1 | 2 | 16 | 32 | 256 | 512 | 65536; // QFLAGS minus TYPE (8)
const QFLAGS_MIN = 1 | 2; // CODE | POSITION
const staleKeys = {};
let fieldQueryDown = false;
function queryLocTier(player, location, flags, fillType, fillRest) {
  try {
    const rows = lib.duelQueryLocation(handle, { flags: flags, controller: player, location: location }) || [];
    return rows.map((r, i) => {
      if (!r) return null;
      const meta = cardByCode.get(r.code) || {};
      return {
        code: r.code || 0, position: r.position || 0,
        type: fillType ? (meta.type || 0) : (r.type || 0),
        level: fillRest ? (meta.level || 0) : (r.level || 0),
        rank: fillRest ? (meta.level || 0) : (r.rank || 0),
        attack: fillRest ? (meta.attack || 0) : (r.attack || 0),
        defense: fillRest ? (meta.defense || 0) : (r.defense || 0),
        materials: fillRest ? 0 : (r.overlayCards || []).length, sequence: i,
      };
    });
  } catch (e) {
    return null;
  }
}
function queryLoc(player, location) {
  const rows = queryLocTier(player, location, QFLAGS_NOTYPE, true, false) || queryLocTier(player, location, QFLAGS_MIN, true, true);
  if (rows === null) {
    const key = player + ':' + location;
    if (!staleKeys[key]) {
      staleKeys[key] = true;
      self.postMessage({ kind: 'core-print', text: 'Field snapshot: one zone list could not be queried this step and shows its previous contents (rendering only; the duel is unaffected).' });
    }
  }
  return rows;
}

function snapshot() {
  let f = null;
  try { f = lib.duelQueryField(handle); } catch (e) { f = null; }
  if (!f || !f.players) {
    if (lastField && !fieldQueryDown) {
      fieldQueryDown = true;
      self.postMessage({ kind: 'core-print', text: 'Field snapshot recovered after a query error (rendering only; the duel is unaffected).' });
    }
    return lastField;
  }
  fieldQueryDown = false;
  const players = [0, 1].map(p => {
    const prev = lastField && lastField.players ? lastField.players[p] : null;
    const q = (loc, key, filter) => {
      const rows = queryLoc(p, loc);
      if (rows === null) return prev ? prev[key] : (filter ? [] : [null, null, null, null, null, null, null]);
      delete staleKeys[p + ':' + loc];
      return filter ? rows.filter(Boolean) : rows;
    };
    return {
      lp: s32(f.players[p].lp),
      deck: f.players[p].deck_size, hand: f.players[p].hand_size,
      /* Hand card rows (passcodes) for rendering the viewing player's hand
         face-up with card images — the field query above reports only the
         hand COUNT. Same guarded tiers as every other location; if the
         query fails the last good rows are kept, like any zone. */
      handCards: q(LOC.HAND, 'handCards', true),
      extra: f.players[p].extra_size, extraFaceup: f.players[p].extra_faceup_count,
      mzone: q(LOC.MZONE, 'mzone', false), szone: q(LOC.SZONE, 'szone', false), fzone: q(LOC.FZONE, 'fzone', false),
      grave: q(LOC.GRAVE, 'grave', true), removed: q(LOC.REMOVED, 'removed', true),
    };
  });
  lastField = { players, chain: (f.chain || []).length };
  return lastField;
}

/* Authoritative LP, tracked from the core's own event messages in the order
   it emits them (Slice E2). This core build does not emit MSG_LPUPDATE in
   ordinary play (a full Maliss vs Ryzeal duel carried 6 MSG_DAMAGE and zero
   MSG_LPUPDATE), so LP is integrated from MSG_DAMAGE / MSG_RECOVER /
   MSG_PAY_LPCOST deltas, with MSG_LPUPDATE applied as an absolute whenever
   it does appear. The duel-end panel reads this — never the field snapshot,
   whose terminal query can fail or lag and previously let a finished duel
   display stale 8000/8000. */
let trackedLp = [8000, 8000];
function trackLp(msgs) {
  for (const m of msgs) {
    if (m.type === 94) trackedLp[m.player] = m.lp;
    else if (m.type === 91 || m.type === 100) trackedLp[m.player] -= m.amount;
    else if (m.type === 92) trackedLp[m.player] += m.amount;
  }
}

function pump() {
  let guard = 0;
  while (guard++ < 40000) {
    let status;
    try {
      status = lib.duelProcess(handle);
    } catch (e) {
      self.postMessage({ kind: 'fatal', text: 'duelProcess threw: ' + (e && e.message || e) });
      return;
    }
    const msgs = lib.duelGetMessage(handle);
    let win = null;
    for (const m of msgs) if (m.type === 5) win = m;
    trackLp(msgs);
    self.postMessage({ kind: 'batch', messages: msgs, field: snapshot(), status });
    if (win) {
      duelOver = true;
      self.postMessage({ kind: 'end', winner: win.player, reason: win.reason, lp: trackedLp.slice(), field: snapshot() });
      return;
    }
    if (status === 0) {
      duelOver = true;
      self.postMessage({ kind: 'end', winner: -1, reason: 0, lp: trackedLp.slice(), field: snapshot() });
      return;
    }
    if (status === 1) {
      let prompt = null;
      for (let i = msgs.length - 1; i >= 0; i--) if (SELECT_TYPES.has(msgs[i].type)) { prompt = msgs[i]; break; }
      if (prompt) lastPrompt = prompt;
      if (lastPrompt) self.postMessage({ kind: 'prompt', message: lastPrompt, fresh: !!prompt });
      else self.postMessage({ kind: 'fatal', text: 'Engine is waiting but sent no decision prompt.' });
      return;
    }
  }
  self.postMessage({ kind: 'fatal', text: 'Process loop guard tripped (40000 steps).' });
}

/* The WASM module is created ONCE, at 'init' time, never inside startDuel.
   Root cause of the desktop-Chrome ENGINE FATAL traps ("null function or
   function signature mismatch" after the first prompt, "memory access out
   of bounds" on the next start, both fixed by a page refresh): startDuel
   used to create the module lazily behind an await (wasm fetch + compile —
   a ~2-3 s window on a cold load). A second 'start' message delivered
   during that window ran a SECOND startDuel concurrently; both resumed
   into shared module state, the second overwriting `lib` with a fresh
   module instance and passing the first instance's duel handle to the
   second instance's destroyDuel. Every later call then crossed instances
   and trapped, and the trapped instance stayed poisoned for the rest of
   the page session. Creating the module at init removes the await from
   startDuel entirely: every message handler below now runs atomically,
   so starts, responses and script merges can no longer interleave. */
let libPromise = null;
function ensureLib() {
  if (lib) return Promise.resolve(lib);
  if (!libPromise) {
    libPromise = (async () => {
      const wasmResp = await fetch(new URL('./ocgcore/ocgcore.sync.wasm', self.location.href));
      if (!wasmResp.ok) throw new Error('Failed to fetch ocgcore.sync.wasm: HTTP ' + wasmResp.status);
      const wasmBinary = await wasmResp.arrayBuffer();
      lib = await createCore({
        sync: true, wasmBinary,
        print: (s) => self.postMessage({ kind: 'core-print', text: String(s) }),
        printErr: (s) => self.postMessage({ kind: 'core-print', text: String(s) }),
      });
      return lib;
    })();
  }
  return libPromise;
}

let startInFlight = false;
function startDuel(cfg) {
  if (!lib) { self.postMessage({ kind: 'fatal', text: 'Engine module is not initialized (start arrived before init completed).' }); return; }
  if (handle) { try { lib.destroyDuel(handle); } catch (e) { /* ignore */ } handle = null; }
  duelOver = false; lastPrompt = null; lastField = null; const startLp = Number(cfg.lp) > 0 ? Number(cfg.lp) : 8000; trackedLp = [startLp, startLp];
  for (const k of Object.keys(staleKeys)) delete staleKeys[k];
  fieldQueryDown = false;
  /* The core rejects an all-zero seed (OCG_CreateDuel returns null — its
     RNG cannot start from 0,0,0,0). A user typing "0,0,0,0" into the seed
     field, or a Pass & Play random seed landing all-zero, would hit that
     as an opaque fatal; substitute the nearest seed instead and say so. */
  let seedArr = cfg.seed.map(s => String(s));
  if (seedArr.every(s => Number(s) === 0)) {
    seedArr = seedArr.slice(); seedArr[3] = '1';
    self.postMessage({ kind: 'core-print', text: 'Seed 0,0,0,0 cannot seed the engine core (its RNG rejects an all-zero seed); using 0,0,0,1 for this duel.' });
  }
  handle = lib.createDuel({
    flags: 190464n, // MODE_MR5 — the Master Rule 5 field shared by Master Duel, TCG and OCG; those formats differ only via the LP/draw options in cfg
    seed: seedArr.map(s => BigInt(s)),
    team1: { startingLP: startLp, startingDrawCount: Number(cfg.startDraw) || 5, drawCountPerTurn: Number(cfg.drawPerTurn) || 1 },
    team2: { startingLP: startLp, startingDrawCount: Number(cfg.startDraw) || 5, drawCountPerTurn: Number(cfg.drawPerTurn) || 1 },
    cardReader, scriptReader,
    errorHandler: (type, text) => self.postMessage({ kind: 'core-error', errType: type, text: String(text) }),
  });
  if (!handle) { self.postMessage({ kind: 'fatal', text: 'OCG_CreateDuel returned null.' }); return; }
  lib.loadScript(handle, 'constant.lua', scriptIndex.util['constant.lua']);
  lib.loadScript(handle, 'utility.lua', scriptIndex.util['utility.lua']);
  /* The core does NOT shuffle the Main Decks at duel start: it deals
     straight off the loaded stack, so without a host-side shuffle every
     duel with the same pairing deals the identical game (deck-list tail
     first) and the duel seed — which only drives the core's in-duel RNG —
     never changes the deal. Shuffle here, Fisher-Yates over a mulberry32
     stream seeded from the duel seed (team-mixed so the two decks get
     independent permutations): same seed + same decks = the same game,
     a different seed = a different game, as the seed field promises. */
  const seedNums = seedArr.map(s => Number(s) >>> 0);
  const shuffledMain = (codes, team) => {
    let a = (seedNums[0] ^ Math.imul(seedNums[1], 0x9E3779B1) ^ Math.imul(seedNums[2], 0x85EBCA6B) ^ Math.imul(seedNums[3], 0xC2B2AE35) ^ Math.imul(team + 1, 0x27D4EB2F)) | 0;
    const rnd = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const arr = codes.slice();
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  };
  const add = (codes, team, loc) => {
    for (const c of codes) lib.duelNewCard(handle, { team, duelist: 0, code: Number(c), controller: team, location: loc, sequence: 0, position: 8 });
  };
  add(shuffledMain(cfg.p1.main, 0), 0, LOC.DECK); add(cfg.p1.extra, 0, LOC.EXTRA);
  add(shuffledMain(cfg.p2.main, 1), 1, LOC.DECK); add(cfg.p2.extra, 1, LOC.EXTRA);
  lib.startDuel(handle);
  self.postMessage({ kind: 'started', field: snapshot() });
  pump();
}

/* Scenario duels (Duel Puzzles + Learn the Table lessons): the duel is
   built from two complete player states instead of two deck lists —
   hands, fields (with positions and face up/down), Graveyards, banished,
   Extra Decks, and Main Decks in exact top-down order. Nothing is
   shuffled and nobody draws an opening hand, so the position is exactly
   the authored one; the core then owns everything from the first Draw
   Phase, exactly as in a deck-list duel. Placement goes through the same
   duelNewCard path deck loading uses, with the position bits the UI's
   snapshot renderer already speaks (1 face-up Attack, 2 face-down
   Attack, 4 face-up Defense, 8 face-down Defense). */
function scenarioSeed(cfg) {
  let seedArr = (cfg.seed || ['4', '29', '54', '119']).map(s => String(s));
  if (seedArr.every(s => Number(s) === 0)) seedArr = ['0', '0', '0', '1'];
  return seedArr.map(s => BigInt(s));
}
function startScenario(cfg) {
  if (!lib) { self.postMessage({ kind: 'fatal', text: 'Engine module is not initialized (start arrived before init completed).' }); return; }
  if (handle) { try { lib.destroyDuel(handle); } catch (e) { /* ignore */ } handle = null; }
  duelOver = false; lastPrompt = null; lastField = null;
  for (const k of Object.keys(staleKeys)) delete staleKeys[k];
  fieldQueryDown = false;
  const P = cfg.players || [];
  const lpOf = i => { const v = Number((P[i] || {}).lp); return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 8000; };
  trackedLp = [lpOf(0), lpOf(1)];
  handle = lib.createDuel({
    flags: 190464n, // MODE_MR5
    seed: scenarioSeed(cfg),
    team1: { startingLP: lpOf(0), startingDrawCount: 0, drawCountPerTurn: 1 },
    team2: { startingLP: lpOf(1), startingDrawCount: 0, drawCountPerTurn: 1 },
    cardReader, scriptReader,
    errorHandler: (type, text) => self.postMessage({ kind: 'core-error', errType: type, text: String(text) }),
  });
  if (!handle) { self.postMessage({ kind: 'fatal', text: 'OCG_CreateDuel returned null for a scenario.' }); return; }
  lib.loadScript(handle, 'constant.lua', scriptIndex.util['constant.lua']);
  lib.loadScript(handle, 'utility.lua', scriptIndex.util['utility.lua']);
  const put = (team, code, loc, seq, pos) => lib.duelNewCard(handle, { team, duelist: 0, code: Number(code), controller: team, location: loc, sequence: seq || 0, position: pos == null ? 1 : pos });
  const posOf = c => c.face === 'down' ? (c.pos === 'def' ? 8 : 2) : (c.pos === 'def' ? 4 : 1);
  P.forEach((pl, team) => {
    pl = pl || {};
    (pl.hand || []).forEach(c => put(team, c, LOC.HAND, 0, 1));
    /* Deck in exact top-down order: the core deals off the tail of the
       loaded stack, so the top card is placed last. */
    const dt = (pl.deckTop || []).slice();
    for (let i = dt.length - 1; i >= 0; i--) put(team, dt[i], LOC.DECK, 0, 8);
    (pl.extra || []).forEach(c => put(team, c, LOC.EXTRA, 0, 8));
    (pl.gy || []).forEach(c => put(team, c, LOC.GRAVE, 0, 1));
    (pl.banished || []).forEach(c => put(team, c, LOC.REMOVED, 0, 1));
    const f = pl.field || {};
    (f.mmz || []).forEach((c, i) => { if (c) put(team, c.id, LOC.MZONE, i, posOf(c)); });
    (f.stz || []).forEach((c, i) => { if (c) put(team, c.id, LOC.SZONE, i, c.face === 'down' ? 8 : 1); });
    if (f.fieldSpell) put(team, f.fieldSpell.id || f.fieldSpell, LOC.FZONE, 0, 1);
  });
  lib.startDuel(handle);
  self.postMessage({ kind: 'started', field: snapshot(), scenario: true });
  pump();
}

self.onmessage = async (ev) => {
  const d = ev.data || {};
  try {
    if (d.kind === 'init') {
      scriptIndex = d.scriptIndex;
      buildCardData(d.cardPack, d.cardMeta);
      /* Create the WASM module now, before 'ready' is posted: 'ready' is
         the UI's signal that Start is safe, and a start must never again
         suspend mid-handler (see ensureLib). */
      await ensureLib();
      self.postMessage({ kind: 'ready' });
    } else if (d.kind === 'addScripts') {
      /* Corpus pack merge (Slice E2): chunk payloads extend the SAME corpus
         index the scriptReader resolves through — passcode -> index -> source.
         No second lookup path is created; entries land in scriptIndex.cards /
         scriptIndex.util alongside the preload subset shipped at init. */
      if (!scriptIndex) scriptIndex = { cards: {}, util: {} };
      if (!scriptIndex.cards) scriptIndex.cards = {};
      if (!scriptIndex.util) scriptIndex.util = {};
      let added = 0;
      if (d.cards) for (const k of Object.keys(d.cards)) { scriptIndex.cards[k] = d.cards[k]; added++; }
      if (d.util) for (const k of Object.keys(d.util)) scriptIndex.util[k] = d.util[k];
      self.postMessage({ kind: 'scripts-added', added: added, total: Object.keys(scriptIndex.cards).length });
    } else if (d.kind === 'start') {
      /* startDuel is fully synchronous (the module was created at init),
         so two starts can never interleave; the flag is belt-and-braces
         against any future await creeping back into the start path. */
      if (startInFlight) { self.postMessage({ kind: 'core-print', text: 'Ignored a duplicate duel start (a start was already in progress).' }); return; }
      startInFlight = true;
      try { startDuel(d); } finally { startInFlight = false; }
    } else if (d.kind === 'scenario') {
      if (startInFlight) { self.postMessage({ kind: 'core-print', text: 'Ignored a duplicate scenario start (a start was already in progress).' }); return; }
      startInFlight = true;
      try { startScenario(d); } finally { startInFlight = false; }
    } else if (d.kind === 'response') {
      if (!handle || duelOver) return;
      const r = d.response;
      if (r && r.type === 16 && Array.isArray(r.races)) r.races = r.races.map(x => BigInt(x));
      if (r && r.type === 19 && typeof r.value === 'string') r.value = Number(r.value);
      if (r && r.type === 15 && Array.isArray(r.order)) {
        /* Sort responses (MSG_SORT_CARD / MSG_SORT_CHAIN), Slice E2 fix.
           The core reads a sort response as raw order bytes from offset 0
           — one byte per position, each the index of the presented card
           that goes there — or a single -1 byte to keep the presented
           order. ocgcore-wasm 0.1.4's response encoder instead prefixes a
           count byte (i8(order.length), then the entries), so every
           explicit order it can produce starts with an out-of-range byte
           and the core rejects it with MSG_RETRY (verified in Node against
           this pinned wrapper+core: explicit orders retried ~19,000 times
           in a row; the patched form below was accepted on the first try
           and the duel completed). duelSetResponse is the wrapper's only
           response entry point and always runs that encoder, so the patch
           is applied to the response OBJECT the encoder consumes: it reads
           order.length for its first byte and then iterates order for the
           rest. Handing it an object whose length is the permutation's
           first entry and whose iterator yields the remaining entries
           makes the encoder emit exactly the raw bytes the core expects —
           no count prefix. (What an upstream wrapper change would need to
           expose instead: a raw-bytes response API, or a sort encoder that
           writes the order without the count byte.) A non-permutation
           order is never sent: it falls back to keep-order (null). */
        const arr = r.order.slice();
        const want = lastPrompt && Array.isArray(lastPrompt.cards) ? lastPrompt.cards.length : arr.length;
        const valid = arr.length > 0 && arr.length === want &&
          arr.every(v => Number.isInteger(v) && v >= 0 && v < arr.length) &&
          new Set(arr).size === arr.length;
        if (valid) {
          r.order = {
            length: arr[0],
            [Symbol.iterator]: function* () { for (let i = 1; i < arr.length; i++) yield arr[i]; },
          };
        } else {
          r.order = null;
        }
      }
      lib.duelSetResponse(handle, r);
      pump();
    }
  } catch (e) {
    self.postMessage({ kind: 'fatal', text: 'Worker error: ' + (e && e.message || e) });
  }
};

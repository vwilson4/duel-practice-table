/* Card text detail loader — the on-demand half of the split card database.
   assets/card-index.js (loaded just before this file) carries every card's
   name and play fields; the full effect text lives in gzipped JSON chunks
   under assets/card-details/, grouped by passcode range and enumerated —
   with each chunk's gz size and SHA-256 — in
   assets/card-details/manifest.json.gz. This mirrors the CardScripts corpus
   pack pipeline (assets/corpus/): a manifest first, then only the chunks a
   viewed or played card actually needs.
   ensure(codes) never rejects: on any failure (offline mid-session, HTTP
   error, hash mismatch) it resolves with the affected codes marked false,
   so readers can degrade to the index fields with an honest note instead of
   a blank card or a console error. Loaded text is handed to the page
   through the merge callback registered via _attach (the page merges it
   into its card database objects in place). */
(function () {
  'use strict';
  var BASE = 'assets/card-details/';
  var MANIFEST_URL = BASE + 'manifest.json.gz';
  var RETRY_MS = 60000;
  var manifest = null, manifestPromise = null, manifestFailedAt = 0;
  var chunkOf = {};
  var chunkState = {}, chunkPromise = {}, chunkFailedAt = {};
  var descs = {};
  var mergeFn = null, queued = {};
  var listeners = [];

  function gunzipText(buf) {
    var stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  function sha256Hex(buf) {
    try {
      if (!window.crypto || !crypto.subtle || !crypto.subtle.digest) return Promise.resolve(null);
      return crypto.subtle.digest('SHA-256', buf).then(function (d) {
        return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (manifestPromise) return manifestPromise;
    if (manifestFailedAt && Date.now() - manifestFailedAt < RETRY_MS) return Promise.resolve(null);
    manifestPromise = fetch(MANIFEST_URL).then(function (r) {
      if (!r.ok) throw new Error('card detail manifest HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) { return gunzipText(buf); }).then(function (text) {
      manifest = JSON.parse(text);
      chunkOf = {};
      manifest.chunks.forEach(function (ch, i) { ch.codes.forEach(function (cd) { chunkOf[cd] = i; }); });
      return manifest;
    }).catch(function () {
      manifestFailedAt = Date.now();
      return null;
    }).then(function (m) { manifestPromise = null; return m; });
    return manifestPromise;
  }
  function noteMerged(code, desc) {
    descs[code] = desc;
    if (mergeFn) { try { mergeFn(code, desc); } catch (e) { /* a merge hiccup must not break the loader */ } }
    else queued[code] = desc;
    listeners.forEach(function (fn) { try { fn(code, desc); } catch (e) { /* listener errors stay local */ } });
  }
  function fetchChunk(i) {
    if (chunkState[i] === 'ok') return Promise.resolve(true);
    if (chunkPromise[i]) return chunkPromise[i];
    if (chunkState[i] === 'failed' && Date.now() - chunkFailedAt[i] < RETRY_MS) return Promise.resolve(false);
    var ch = manifest.chunks[i];
    chunkState[i] = 'loading';
    var p = fetch(BASE + ch.f).then(function (r) {
      if (!r.ok) throw new Error('card detail chunk HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      return sha256Hex(buf).then(function (h) {
        if (h && ch.sha256 && h !== ch.sha256) throw new Error('card detail chunk hash mismatch');
        return gunzipText(buf);
      });
    }).then(function (text) {
      var payload = JSON.parse(text), cards = payload.cards || {};
      Object.keys(cards).forEach(function (k) { noteMerged(k, cards[k]); });
      chunkState[i] = 'ok';
      return true;
    }).catch(function () {
      chunkState[i] = 'failed'; chunkFailedAt[i] = Date.now();
      return false;
    }).then(function (ok) { delete chunkPromise[i]; return ok; });
    chunkPromise[i] = p;
    return p;
  }
  /* Alias canonicalization: a deck-file passcode that is not a real printing
     resolves to the real card before any chunk lookup — the Jizukiru deck-file
     passcode 15668122 is an alias of 63941210, the same alias the page's card
     database, image lookup and engine all use. The alias registry lives in
     the page's main script (loaded after this file), so it is read lazily at
     call time; results are reported under the REQUESTED code. */
  function canonical(code) {
    var k = String(Number(code));
    try {
      if (typeof CARD_ALIASES !== 'undefined' && CARD_ALIASES) {
        if (CARD_ALIASES[k]) return String(CARD_ALIASES[k]);
        if (CARD_ALIASES[String(code)]) return String(CARD_ALIASES[String(code)]);
      }
    } catch (e) { /* no registry yet — the code stands as-is */ }
    return k;
  }
  function ensure(codes) {
    var want = {}, list = [], aliasOfReq = {};
    (codes || []).forEach(function (c) {
      var req = String(Number(c)), k = canonical(c);
      aliasOfReq[req] = k;
      if (k && k !== 'NaN' && !want[k]) { want[k] = 1; list.push(k); }
    });
    if (!list.length) return Promise.resolve({});
    function remap(out) {
      var fin = {};
      Object.keys(aliasOfReq).forEach(function (r) { fin[r] = !!out[aliasOfReq[r]]; });
      return fin;
    }
    return loadManifest().then(function (man) {
      var out = {}, byChunk = {};
      list.forEach(function (k) {
        if (descs[k]) { out[k] = true; return; }
        var ci = chunkOf[k];
        if (!man || ci === undefined) { out[k] = false; return; }
        (byChunk[ci] = byChunk[ci] || []).push(k);
      });
      var jobs = Object.keys(byChunk).map(function (ci) {
        return fetchChunk(Number(ci)).then(function () {
          byChunk[ci].forEach(function (k) { out[k] = !!descs[k]; });
        });
      });
      return Promise.all(jobs).then(function () { return remap(out); });
    }).catch(function () {
      var out = {};
      list.forEach(function (k) { out[k] = !!descs[k]; });
      return remap(out);
    });
  }
  window.FNCardDetails = {
    ensure: ensure,
    get: function (code) { return descs[canonical(code)]; },
    has: function (code) { return !!descs[canonical(code)]; },
    onLoad: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    _attach: function (fn) {
      mergeFn = fn;
      var q = queued; queued = {};
      Object.keys(q).forEach(function (k) { try { fn(k, q[k]); } catch (e) { /* see noteMerged */ } });
    }
  };
})();

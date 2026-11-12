/* ===== 04-search: instant full-text search, typo tolerance, related notes (TF-IDF) ===== */

const Search = {
  wordSets: new Map(),
  idf: null,

  wordsOf(n) {
    const d = Store.d(n);
    let w = this.wordSets.get(n.id);
    if (w && w.at === d.at && w.html === n.html && w.title === n.title) return w.set;
    const set = new Set([...words(n.title), ...words(d.text), ...(n.tags || []).map(norm)]);
    this.wordSets.set(n.id, { at: d.at, html: n.html, title: n.title, set });
    return set;
  },

  parse(q) {
    const tags = [], terms = [];
    for (const raw of String(q || '').trim().split(/\s+/)) {
      if (!raw) continue;
      if (raw.startsWith('#') && raw.length > 1) tags.push(norm(raw.slice(1)));
      else terms.push(...words(raw));
    }
    return { tags, terms };
  },

  /** filters: {folderId, tag, has: 'tasks'|'image'|'attachment'|'open', flag: 'pinned'|'favorite', since: ms, scope: 'active'|'archived'|'all'} */
  run(q, filters = {}) {
    const { tags, terms } = this.parse(q);
    let pool = filters.scope === 'archived' ? Store.list({ archived: true }) : filters.scope === 'all' ? [...Store.list(), ...Store.list({ archived: true })] : Store.active();
    if (filters.tag) tags.push(norm(filters.tag));
    const folderSet = filters.folderId ? Store.folderDescendants(filters.folderId) : null;
    pool = pool.filter(n => {
      if (folderSet && !folderSet.has(n.folderId)) return false;
      if (tags.length && !tags.every(t => (n.tags || []).some(x => norm(x).startsWith(t)))) return false;
      if (filters.flag === 'pinned' && !n.pinned) return false;
      if (filters.flag === 'favorite' && !n.favorite) return false;
      if (filters.since && n.updatedAt < filters.since) return false;
      if (filters.has) {
        const d = Store.d(n);
        if (filters.has === 'tasks' && !d.tasks.length) return false;
        if (filters.has === 'open' && !d.tasks.some(t => !t.done)) return false;
        if (filters.has === 'image' && !d.img) return false;
        if (filters.has === 'attachment' && !d.hasAtt) return false;
      }
      return true;
    });
    if (!terms.length) return pool.map(n => ({ n, score: 0 }));
    const results = [];
    for (const n of pool) {
      const d = Store.d(n); let score = 0, ok = true;
      for (const t of terms) {
        let s = 0;
        if (d.normTitle.includes(t)) s += d.normTitle.startsWith(t) ? 14 : 9;
        if ((n.tags || []).some(x => norm(x).startsWith(t))) s += 7;
        const idx = d.normText.indexOf(t);
        if (idx >= 0) { s += 3; let c = 0, p = idx; while (p >= 0 && c < 6) { c++; p = d.normText.indexOf(t, p + t.length); } s += c * .6; }
        if (!s && t.length >= 4) {
          for (const w of this.wordsOf(n)) if (Math.abs(w.length - t.length) <= 1 && lev(w, t) <= 1) { s = 1.5; break; }
        }
        if (!s) { ok = false; break; }
        score += s;
      }
      if (!ok) continue;
      score += Math.max(0, 2 - (now() - n.updatedAt) / (30 * 86400000));
      if (n.pinned) score += .5;
      results.push({ n, score });
    }
    return results.sort((a, b) => b.score - a.score);
  },

  /** Highlighted snippet around the first matching term. */
  snippet(n, q) {
    const d = Store.d(n); const { terms } = this.parse(q);
    const text = d.text.replace(/\s+/g, ' ');
    if (!terms.length) return esc(text.slice(0, 160));
    const nt = norm(text);
    let at = -1; for (const t of terms) { const i = nt.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) return esc(text.slice(0, 160));
    const start = Math.max(0, at - 50); let s = text.slice(start, start + 170);
    // Highlight using normalized positions (same length mapping for most Latin text).
    const ns = norm(s); const marks = [];
    for (const t of terms) { let i = ns.indexOf(t); while (i >= 0) { marks.push([i, i + t.length]); i = ns.indexOf(t, i + t.length); } }
    if (ns.length !== s.length) return (start ? '…' : '') + esc(s);
    marks.sort((a, b) => a[0] - b[0]);
    let out = '', p = 0;
    for (const [a, b] of marks) { if (a < p) continue; out += esc(s.slice(p, a)) + '<mark>' + esc(s.slice(a, b)) + '</mark>'; p = b; }
    return (start ? '…' : '') + out + esc(s.slice(p));
  },
  highlight(text, q) {
    const { terms } = this.parse(q); const nt = norm(text);
    if (!terms.length || nt.length !== text.length) return esc(text);
    const marks = []; for (const t of terms) { let i = nt.indexOf(t); while (i >= 0) { marks.push([i, i + t.length]); i = nt.indexOf(t, i + t.length); } }
    marks.sort((a, b) => a[0] - b[0]); let out = '', p = 0;
    for (const [a, b] of marks) { if (a < p) continue; out += esc(text.slice(p, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; p = b; }
    return out + esc(text.slice(p));
  },

  /* ----- Related notes: TF-IDF cosine similarity, plus explicit links ----- */
  vec(n) {
    const tf = new Map();
    const ws = [...words(n.title), ...words(n.title), ...words(Store.d(n).text), ...(n.tags || []).flatMap(t => [norm(t), norm(t), norm(t)])];
    for (const w of ws) if (!STOP.has(w) && w.length > 2) tf.set(w, (tf.get(w) || 0) + 1);
    return tf;
  },
  buildIdf() {
    const notes = Store.active(); const df = new Map();
    for (const n of notes) for (const w of this.wordsOf(n)) df.set(w, (df.get(w) || 0) + 1);
    this.idf = { N: notes.length, df, at: now() };
  },
  related(id, k = 4) {
    const src = Store.get(id); if (!src) return [];
    if (!this.idf || now() - this.idf.at > 60000) this.buildIdf();
    const { N, df } = this.idf;
    const weight = (tf) => { const m = new Map(); let nn = 0; for (const [w, c] of tf) { const v = (1 + Math.log(c)) * Math.log(1 + N / (1 + (df.get(w) || 0))); m.set(w, v); nn += v * v; } return { m, nn: Math.sqrt(nn) || 1 }; };
    const a = weight(this.vec(src));
    const linked = new Set(Store.d(src).links);
    const out = [];
    for (const n of Store.active()) {
      if (n.id === id || linked.has(n.id) || Store.d(n).links.includes(id)) continue;
      const b = weight(this.vec(n)); let dot = 0;
      for (const [w, v] of a.m) { const u = b.m.get(w); if (u) dot += v * u; }
      const sim = dot / (a.nn * b.nn);
      if (sim > .08) out.push({ n, sim });
    }
    return out.sort((x, y) => y.sim - x.sim).slice(0, k);
  },
  backlinks(id) { return Store.active().filter(n => n.id !== id && Store.d(n).links.includes(id)); },
};
Bus.on('notes', () => { if (Search.idf) Search.idf.at = 0; });

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= n; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > 1) return 2;
    prev = cur;
  }
  return prev[n];
}

/* ===== 01-store: local-first persistence (IndexedDB), app state, derived index ===== */

const Bus = (() => {
  const m = new Map();
  return {
    on(ev, fn) { (m.get(ev) || m.set(ev, new Set()).get(ev)).add(fn); return () => m.get(ev).delete(fn); },
    emit(ev, data) { (m.get(ev) || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
  };
})();

/** Minimal promise wrapper around IndexedDB. Falls back to memory if IDB is unavailable. */
const IDB = (() => {
  let db = null, mem = null;
  const STORES = ['notes', 'blobs', 'versions', 'kv'];
  function open() {
    return new Promise((res) => {
      let req;
      try { req = indexedDB.open('margin', 2); } catch (e) { return res(false); }
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) {
          const os = d.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' });
          if (s === 'versions') os.createIndex('noteId', 'noteId');
        }
      };
      req.onsuccess = () => { db = req.result; res(true); };
      req.onerror = () => res(false);
      req.onblocked = () => res(false);
      setTimeout(() => res(!!db), 4000);
    });
  }
  function tx(store, mode, fn) {
    if (!db) {
      mem = mem || Object.fromEntries(STORES.map(s => [s, new Map()]));
      return Promise.resolve(fn(null, mem[store]));
    }
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode); const os = t.objectStore(store);
      let out; const r = fn(os, null);
      if (r && typeof r === 'object' && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  const keyOf = (s, v) => s === 'kv' ? v.k : v.id;
  return {
    get persistent() { return !!db; },
    open,
    get: (s, k) => tx(s, 'readonly', (os, m) => m ? m.get(k) : os.get(k)),
    put: (s, v) => tx(s, 'readwrite', (os, m) => m ? m.set(keyOf(s, v), v) : os.put(v)),
    del: (s, k) => tx(s, 'readwrite', (os, m) => m ? m.delete(k) : os.delete(k)),
    all: (s) => tx(s, 'readonly', (os, m) => m ? [...m.values()] : os.getAll()),
    byIndex: (s, idx, v) => tx(s, 'readonly', (os, m) => m ? [...m.values()].filter(x => x[idx] === v) : os.index(idx).getAll(v)),
    clear: (s) => tx(s, 'readwrite', (os, m) => m ? m.clear() : os.clear()),
  };
})();

const DEVICE_ID = (() => { try { let d = localStorage.getItem('margin.device'); if (!d) { d = uid('d'); localStorage.setItem('margin.device', d); } return d; } catch (e) { return uid('d'); } })();

const NOTE_COLORS = [['yellow', 'Gul'], ['pink', 'Lyserød'], ['green', 'Grøn'], ['blue', 'Blå'], ['orange', 'Orange'], ['purple', 'Lilla'], ['white', 'Hvid']];
const FOLDER_COLORS = ['#2f5bff', '#e5484d', '#f08c00', '#2f9e5b', '#7a46d8', '#0b8ea8', '#d6409f', '#6b717d'];
const DEFAULT_SETTINGS = { name: '', theme: 'dark', edSize: 17, onboarded: false, trashDays: 30, updatedAt: 0 };

const Store = {
  notes: new Map(),
  meta: { folders: {}, smart: {}, habits: {}, templates: {}, settings: { ...DEFAULT_SETTINGS } },
  derived: new Map(),
  blobCache: new Map(),

  async init() {
    await IDB.open();
    const [notes, meta] = await Promise.all([IDB.all('notes').catch(() => []), IDB.get('kv', 'meta').catch(() => null)]);
    for (const n of notes || []) this.notes.set(n.id, n);
    if (meta && meta.v) this.meta = Object.assign(this.meta, meta.v);
    this.meta.settings = { ...DEFAULT_SETTINGS, ...this.meta.settings };
    this.purgeTrash();
  },

  /* ----- notes ----- */
  get(id) { return this.notes.get(id); },
  list({ trashed = false, archived = false, templates = false } = {}) {
    const out = [];
    for (const n of this.notes.values()) {
      if (!!n.trashedAt !== trashed) continue;
      if (!trashed && !!n.archived !== archived) continue;
      out.push(n);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  active() { return this.list(); },
  create(p = {}) {
    const t = now();
    const n = {
      id: uid('n'), title: '', html: '<p></p>', folderId: null, tags: [], pinned: false, favorite: false, archived: false,
      trashedAt: null, createdAt: t, updatedAt: t, rev: 0, baseRev: 0, dirty: true, kind: 'note', color: 'yellow', ...p,
    };
    this.notes.set(n.id, n);
    this.persist(n);
    this.track('create');
    Bus.emit('notes', { id: n.id, type: 'create' });
    Sync.queue(n.id);
    return n;
  },
  update(id, patch, { touch = true, quiet = false } = {}) {
    const n = this.notes.get(id); if (!n) return;
    let changed = false;
    for (const k in patch) if (JSON.stringify(n[k]) !== JSON.stringify(patch[k])) { n[k] = patch[k]; changed = true; }
    if (!changed) return n;
    if (touch) n.updatedAt = now();
    n.dirty = true; n.localSeq = (n.localSeq || 0) + 1;
    this.derived.delete(id);
    this.persist(n);
    if (patch.html !== undefined) this.track('edit', id);
    if (!quiet) Bus.emit('notes', { id, type: 'update' });
    Sync.queue(id);
    return n;
  },
  persist(n) { return IDB.put('notes', n).catch(e => { console.warn('persist failed', e); Bus.emit('storage-error', e); }); },
  trash(id) { this.update(id, { trashedAt: now(), pinned: false }); },
  restore(id) { this.update(id, { trashedAt: null, archived: false }); },
  async destroy(id) {
    const n = this.notes.get(id); if (!n) return;
    this.notes.delete(id); this.derived.delete(id);
    await IDB.del('notes', id).catch(() => {});
    Sync.queueDelete(id, !!n.baseWid);
    Bus.emit('notes', { id, type: 'delete' });
  },
  purgeTrash() {
    const days = this.meta.settings.trashDays || 30, cutoff = now() - days * 86400000;
    for (const n of [...this.notes.values()]) if (n.trashedAt && n.trashedAt < cutoff) this.destroy(n.id);
  },

  /* ----- derived index (text, tasks, links) ----- */
  d(n) {
    if (typeof n === 'string') n = this.notes.get(n);
    if (!n) return null;
    let d = this.derived.get(n.id);
    if (d && d.at === n.updatedAt && d.html === n.html) return d;
    d = deriveNote(n);
    this.derived.set(n.id, d);
    return d;
  },

  /* ----- meta entities (folders, smart collections, habits, templates) ----- */
  entities(kind) {
    return Object.values(this.meta[kind] || {}).filter(e => !e.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);
  },
  entity(kind, id) { const e = this.meta[kind]?.[id]; return e && !e.deleted ? e : null; },
  upsert(kind, e) {
    const t = now();
    const prev = this.meta[kind][e.id] || { createdAt: t };
    this.meta[kind][e.id] = { ...prev, ...e, updatedAt: t };
    this.saveMeta();
    return this.meta[kind][e.id];
  },
  remove(kind, id) { if (this.meta[kind][id]) { this.meta[kind][id] = { id, deleted: true, updatedAt: now() }; this.saveMeta(); } },
  setting(k) { return this.meta.settings[k]; },
  setSetting(k, v) { this.meta.settings[k] = v; this.meta.settings.updatedAt = now(); this.saveMeta(); Bus.emit('settings', k); },
  saveMeta(fromRemote = false) {
    IDB.put('kv', { k: 'meta', v: this.meta }).catch(() => {});
    Bus.emit('meta');
    if (!fromRemote) Sync.queueMeta();
  },
  folderPath(id) {
    const out = []; let f = this.entity('folders', id), guard = 0;
    while (f && guard++ < 20) { out.unshift(f); f = f.parentId ? this.entity('folders', f.parentId) : null; }
    return out;
  },
  folderDescendants(id) {
    const all = this.entities('folders'), out = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const f of all) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; } }
    return out;
  },
  allTags() {
    const m = new Map();
    for (const n of this.active()) for (const t of n.tags || []) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  },

  /* ----- blobs (images & attachments) ----- */
  async putBlob(b) {
    this.blobCache.set(b.id, b);
    await IDB.put('blobs', b).catch(() => {});
    Sync.queueBlob(b.id);
  },
  async getBlob(id) {
    if (this.blobCache.has(id)) return this.blobCache.get(id);
    let b = await IDB.get('blobs', id).catch(() => null);
    if (!b) b = await Sync.fetchBlob(id);
    if (b) this.blobCache.set(id, b);
    return b;
  },

  /* ----- version history (local, per device) ----- */
  async snapshot(n, reason = 'auto') {
    if (!n || (!n.title && wordCount(htmlToText(n.html)) < 3)) return;
    const vs = await IDB.byIndex('versions', 'noteId', n.id).catch(() => []);
    vs.sort((a, b) => b.at - a.at);
    if (reason === 'auto' && vs[0] && now() - vs[0].at < 5 * 60000) return;
    if (vs[0] && vs[0].html === n.html && vs[0].title === n.title) return;
    await IDB.put('versions', { id: uid('v'), noteId: n.id, at: now(), title: n.title, html: n.html, reason }).catch(() => {});
    for (const old of vs.slice(29)) IDB.del('versions', old.id).catch(() => {});
  },
  async versions(noteId) { const vs = await IDB.byIndex('versions', 'noteId', noteId).catch(() => []); return vs.sort((a, b) => b.at - a.at); },

  /* ----- activity (words written per day, notes touched) ----- */
  activity: null,
  async loadActivity() { const a = await IDB.get('kv', 'activity').catch(() => null); this.activity = (a && a.v) || { days: {} }; },
  track(type, id) {
    if (!this.activity) return;
    const k = ymd(); const day = this.activity.days[k] || (this.activity.days[k] = { edits: 0, created: 0, notes: [] });
    if (type === 'create') day.created++;
    if (type === 'edit') { day.edits++; if (id && !day.notes.includes(id)) day.notes.push(id); }
    const keys = Object.keys(this.activity.days).sort(); while (keys.length > 60) delete this.activity.days[keys.shift()];
    this.saveActivity();
  },
  saveActivity: debounce(function () { IDB.put('kv', { k: 'activity', v: Store.activity }).catch(() => {}); }, 1500),

  kvGet: (k) => IDB.get('kv', k).then(r => r && r.v).catch(() => null),
  kvSet: (k, v) => IDB.put('kv', { k, v }).catch(() => {}),
};

/** Parse note HTML once into everything the UI and search need. */
const _parseTpl = document.createElement('template');
function deriveNote(n) {
  _parseTpl.innerHTML = n.html || '';
  const root = _parseTpl.content;
  const tasks = [];
  $$('ul.checklist > li', root).forEach((li, i) => {
    const due = li.querySelector('.due');
    const clone = li.cloneNode(true); $$('.due, ul, ol', clone).forEach(x => x.remove());
    const text = clone.textContent.trim();
    if (text) tasks.push({ i, text, done: li.getAttribute('data-checked') === 'true', due: due ? due.getAttribute('data-due') : null });
  });
  const links = [...new Set($$('a[data-note]', root).map(a => a.getAttribute('data-note')))];
  const img = root.querySelector('img[data-blob]');
  const text = htmlToText(n.html);
  const wc = wordCount(text);
  return {
    at: n.updatedAt, html: n.html, text, snippet: text.replace(/\s+/g, ' ').trim().slice(0, 220),
    words: wc, readMin: Math.max(1, Math.round(wc / 220)), tasks, links, img: img ? img.getAttribute('data-blob') : null,
    normTitle: norm(n.title), normText: norm(text), hasAtt: !!root.querySelector('.att'),
  };
}
function htmlToText(html) {
  _parseTpl.innerHTML = (html || '').replace(/<(\/p|\/h[1-6]|\/li|br|\/blockquote|\/pre|\/tr|hr)[^>]*>/gi, '$&\n');
  $$('.due', _parseTpl.content).forEach(x => x.remove());
  return _parseTpl.content.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
function noteTitle(n) { return (n && n.title && n.title.trim()) || (n && (Store.d(n)?.text || '').split('\n')[0].trim().slice(0, 60)) || 'Ny note'; }

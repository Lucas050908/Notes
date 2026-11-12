/* ===== 02-sync: offline-first cloud sync over the artifact `db` capability =====
   Layout in the store (private per signed-in user):
     data/users/<uid>/vault/notes/<noteId>   one doc per note
     data/users/<uid>/vault/meta/main        folders, smart collections, habits, templates, settings
     data/users/<uid>/vault/blobs/<blobId>   blob header {name,type,size,chunks}
     data/users/<uid>/vault/chunks/<id>~<i>  base64 chunks (<= 200k chars each)
   Conflicts: every push carries a write id (wid). A remote doc whose wid differs from the local base is
   adopted when the local copy is clean; when both changed, local wins and the remote text is kept in
   version history so nothing is lost. */

const Sync = {
  state: 'local', // local | connecting | synced | syncing | offline | error
  message: '',
  db: null, base: null, uid: null,
  dirty: new Set(), deletes: new Map(), blobs: new Set(), metaDirty: false,
  ownWids: new Set(), busy: false, retryMs: 2000, firstServer: false,

  setState(s, msg = '') { this.state = s; this.message = msg; Bus.emit('sync', s); },

  async start() {
    const q = await Store.kvGet('syncQueue');
    if (q) { (q.deletes || []).forEach(([k, v]) => this.deletes.set(k, v)); (q.blobs || []).forEach(b => this.blobs.add(b)); this.metaDirty = !!q.meta; }
    for (const n of Store.notes.values()) if (n.dirty) this.dirty.add(n.id);
    if (!window.claude || typeof window.claude.use !== 'function') return this.setState('local');
    this.setState('connecting');
    let db = null, user = null;
    try { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } catch (e) {}
    if (!db || !user) return this.setState('local');
    let id = null; try { id = await user.id(); } catch (e) {}
    if (!id) return this.setState('local');
    this.db = db; this.uid = id;
    try { this.base = db.collection('data/users/' + id).doc('vault'); } catch (e) { console.error(e); return this.setState('local'); }
    this.listen();
  },

  listen() {
    const timer = setTimeout(() => { if (!this.firstServer) this.setState('offline', 'Skyen svarer ikke endnu. Dine noter gemmes lokalt.'); }, 10000);
    this.base.collection('notes').onSnapshot(snap => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') { if (!snap.metadata.fromCache) this.applyRemoval(ch.doc.id); }
        else this.applyRemote(ch.doc.id, ch.doc.data());
      }
      if (!snap.metadata.fromCache && !this.firstServer) {
        this.firstServer = true; clearTimeout(timer);
        const remoteIds = new Set(snap.docs.map(d => d.id));
        for (const n of [...Store.notes.values()]) {
          if (!remoteIds.has(n.id)) { if (n.baseWid && !n.dirty) Store.destroyLocal(n.id); else this.queue(n.id); }
        }
        this.setState(this.pending() ? 'syncing' : 'synced');
        this.flush();
      }
    }, err => this.onError(err, 'listen'));
    this.base.collection('meta').doc('main').onSnapshot(snap => {
      if (snap.exists) this.mergeMeta(snap.data());
      else if (!snap.metadata.fromCache) this.queueMeta();
    }, err => this.onError(err, 'meta'));
  },

  pending() { return this.dirty.size + this.deletes.size + this.blobs.size + (this.metaDirty ? 1 : 0); },

  applyRemote(id, r) {
    if (!r) return;
    const local = Store.notes.get(id);
    if (local && r.wid && r.wid === local.baseWid) return;
    if (local && r.dev === DEVICE_ID && this.ownWids.has(r.wid)) { return; }
    const remoteNote = { ...r, id, html: sanitizeHtml(String(r.html || '<p></p>')), title: String(r.title || ''), dirty: false, baseWid: r.wid };
    delete remoteNote.dev; delete remoteNote.wid; delete remoteNote.seq;
    if (!local) {
      Store.notes.set(id, remoteNote); Store.persist(remoteNote); Bus.emit('notes', { id, type: 'remote' }); return;
    }
    if (!local.dirty) {
      Object.assign(local, remoteNote); Store.derived.delete(id); Store.persist(local);
      Bus.emit('notes', { id, type: 'remote' }); return;
    }
    // Both changed. Same content? Just adopt the base.
    if (local.html === r.html && local.title === r.title) { local.baseWid = r.wid; Store.persist(local); return; }
    Store.snapshot({ ...remoteNote, id }, 'conflict');
    local.baseWid = r.wid; Store.persist(local); this.queue(id);
    Bus.emit('conflict', { id, title: noteTitle(local) });
  },
  applyRemoval(id) {
    const n = Store.notes.get(id); if (!n) return;
    if (n.dirty) { n.baseWid = null; this.queue(id); return; }
    Store.destroyLocal(id);
  },

  mergeMeta(remote) {
    const local = Store.meta; let localNewer = false, changed = false;
    for (const kind of ['folders', 'smart', 'habits', 'templates']) {
      const R = remote[kind] || {}, L = local[kind] || (local[kind] = {});
      for (const id of new Set([...Object.keys(R), ...Object.keys(L)])) {
        const r = R[id], l = L[id];
        if (r && (!l || (r.updatedAt || 0) > (l.updatedAt || 0))) { L[id] = r; changed = true; }
        else if (l && (!r || (l.updatedAt || 0) > (r.updatedAt || 0))) localNewer = true;
      }
    }
    const rs = remote.settings || {};
    if ((rs.updatedAt || 0) > (local.settings.updatedAt || 0)) { local.settings = { ...DEFAULT_SETTINGS, ...rs }; changed = true; Bus.emit('settings', '*'); }
    else if ((local.settings.updatedAt || 0) > (rs.updatedAt || 0)) localNewer = true;
    if (changed) Store.saveMeta(true);
    if (localNewer) this.queueMeta();
  },

  /* ----- queueing ----- */
  queue(id) { this.dirty.add(id); this.kick(); },
  queueDelete(id, remote) { this.dirty.delete(id); if (remote || this.db) { this.deletes.set(id, true); this.saveQueue(); this.kick(); } },
  queueBlob(id) { this.blobs.add(id); this.saveQueue(); this.kick(); },
  queueMeta() { this.metaDirty = true; this.saveQueue(); this.kick(); },
  saveQueue() { Store.kvSet('syncQueue', { deletes: [...this.deletes], blobs: [...this.blobs], meta: this.metaDirty }); },
  kick: debounce(function () { Sync.flush(); }, 1200),

  async flush() {
    if (!this.base || !this.firstServer || this.busy) return;
    this.busy = true;
    if (this.pending()) this.setState('syncing');
    try {
      for (const id of [...this.blobs]) { await this.pushBlob(id); this.blobs.delete(id); this.saveQueue(); }
      for (const id of [...this.dirty]) { await this.pushNote(id); }
      for (const id of [...this.deletes.keys()]) {
        await this.base.collection('notes').doc(id).delete(); this.deletes.delete(id); this.saveQueue();
      }
      if (this.metaDirty) {
        this.metaDirty = false; this.saveQueue();
        await this.base.collection('meta').doc('main').set(JSON.parse(JSON.stringify(Store.meta)));
      }
      this.retryMs = 2000;
      this.setState('synced');
      Store.kvSet('lastSync', now());
    } catch (e) {
      this.onError(e, 'flush');
    } finally {
      this.busy = false;
      if (this.pending() && this.state !== 'error') setTimeout(() => this.flush(), this.state === 'synced' ? 300 : this.retryMs);
    }
  },

  async pushNote(id) {
    const n = Store.notes.get(id);
    if (!n) { this.dirty.delete(id); return; }
    const wid = uid('w'); const seq = n.localSeq || 0;
    const body = {
      title: n.title || '', html: n.html || '', folderId: n.folderId || null, tags: n.tags || [], pinned: !!n.pinned, favorite: !!n.favorite,
      archived: !!n.archived, trashedAt: n.trashedAt || null, createdAt: n.createdAt, updatedAt: n.updatedAt, kind: n.kind || 'note',
      dailyDate: n.dailyDate || null, color: n.color || 'yellow', rev: (n.rev || 0) + 1, wid, dev: DEVICE_ID, seq,
    };
    const size = JSON.stringify(body).length;
    if (size > 250000) {
      this.dirty.delete(id);
      if (!n.syncError) { n.syncError = 'too-large'; Store.persist(n); Bus.emit('sync-note-error', { id, title: noteTitle(n) }); }
      return;
    }
    this.ownWids.add(wid); if (this.ownWids.size > 200) this.ownWids.delete(this.ownWids.values().next().value);
    await this.base.collection('notes').doc(id).set(body);
    const cur = Store.notes.get(id); if (!cur) return;
    cur.baseWid = wid; cur.rev = body.rev; delete cur.syncError;
    if ((cur.localSeq || 0) === seq) { cur.dirty = false; this.dirty.delete(id); }
    Store.persist(cur);
  },

  async pushBlob(id) {
    const b = await IDB.get('blobs', id).catch(() => null);
    if (!b) return;
    const CH = 200000; const n = Math.ceil(b.dataUrl.length / CH);
    for (let i = 0; i < n; i++) await this.base.collection('chunks').doc(id + '~' + i).set({ d: b.dataUrl.slice(i * CH, (i + 1) * CH) });
    await this.base.collection('blobs').doc(id).set({ name: b.name || '', type: b.type || '', size: b.size || 0, chunks: n, createdAt: b.createdAt || now() });
  },
  async fetchBlob(id) {
    if (!this.base) return null;
    try {
      const h = await this.base.collection('blobs').doc(id).get();
      if (!h.exists) return null;
      const meta = h.data(); const parts = [];
      for (let i = 0; i < meta.chunks; i++) { const c = await this.base.collection('chunks').doc(id + '~' + i).get(); if (!c.exists) return null; parts.push(c.data().d); }
      const b = { id, name: meta.name, type: meta.type, size: meta.size, createdAt: meta.createdAt, dataUrl: parts.join('') };
      IDB.put('blobs', b).catch(() => {});
      return b;
    } catch (e) { return null; }
  },

  onError(e, where) {
    const code = e && e.code;
    console.warn('sync error', where, e);
    if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
      this.base = null; return this.setState('local');
    }
    if (code === 'quota_exceeded') return this.setState('error', 'Skylageret er fuldt. Slet noter i papirkurven eller store vedhæftninger for at fortsætte synkroniseringen.');
    if (code === 'invalid_argument') return this.setState('error', 'En note kunne ikke synkroniseres. Den er stadig gemt på denne enhed.');
    this.retryMs = Math.min(this.retryMs * 2, 60000);
    this.setState('offline', 'Ingen forbindelse til skyen. Ændringer gemmes lokalt og synkroniseres automatisk.');
  },
  label() {
    return ({ local: 'Kun på denne enhed', connecting: 'Forbinder…', synced: 'Synkroniseret', syncing: 'Synkroniserer…', offline: 'Offline · gemt lokalt', error: 'Synkroniseringsfejl' })[this.state];
  },
};

Store.destroyLocal = function (id) {
  this.notes.delete(id); this.derived.delete(id);
  IDB.del('notes', id).catch(() => {});
  Bus.emit('notes', { id, type: 'delete', remote: true });
};
window.addEventListener('online', () => Sync.flush());

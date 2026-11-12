/* ===== 08-editor: the writing surface ===== */

try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

function newNote(p = {}) {
  const n = Store.create({ ...p, folderId: p.folderId ?? (Nav.top() && Nav.top().folderId) ?? null });
  openNote(n.id, { isNew: true });
  return n;
}

const BLOCK_SEL = 'p,h1,h2,h3,li,blockquote,pre,div.att,div.tw,hr';

function openNote(id, opts = {}) {
  const note = Store.get(id); if (!note) return UI.toast('Noten findes ikke længere');
  // If this note is already open on top, do nothing; if open deeper, pop back to it.
  const already = Nav.stack.findIndex(s => s.noteId === id);
  if (already >= 0) { while (Nav.stack.length - 1 > already) Nav.pop(); return; }
  const ed = new Editor(note, opts);
  Nav.push(ed.screen);
  return ed;
}

class Editor {
  constructor(note, opts) {
    this.id = note.id; this.opts = opts; this.dirtyLocal = false; this.firstEdit = true;
    this.hist = { states: [], idx: -1, lastAt: 0, lastType: '' };
    this.build();
    this.load();
    const screen = this.screen = {
      el: this.el, noteId: this.id, noFab: true, flushSave: () => { if (this.dirtyLocal) this.flush(); },
      render: () => this.renderMeta(),
      onShow: () => { if (opts.isNew) setTimeout(() => this.title.focus(), 380); else if (opts.highlight) setTimeout(() => this.findText(opts.highlight), 400); },
      onHide: () => this.close(),
    };
    this.offNotes = Bus.on('notes', e => { if (e.id === this.id && e.type === 'remote') this.onRemote(); if (e.id === this.id && e.type === 'delete') { if (Nav.top() === screen) Nav.pop(); } });
    this.offSync = Bus.on('sync', () => this.renderStatus());
    this.offKb = Bus.on('kb', off => this.placeBar(off));
  }

  get note() { return Store.get(this.id); }

  /* ---------- DOM ---------- */
  build() {
    const el = this.el = h('section.screen.paper.st-' + (this.note.color || 'yellow'));
    const backLabel = Nav.stack.length ? 'Tilbage' : ({ home: 'Hjem', notes: 'Noter', tasks: 'Opgaver', assistant: 'Assistent' })[Nav.current];
    this.status = h('div.status', { html: '<i></i><span>Gemt</span>' });
    this.aiBtn = h('button.iconbtn.accent' + (AI.available ? '' : '.hidden'), { 'aria-label': 'AI-værktøjer', title: 'AI', html: icon('spark'), onclick: () => AI.editorSheet(this) });
    const bar = h('header.topbar.ed-top',
      h('button.backbtn', { 'aria-label': 'Tilbage', html: icon('back') + `<span>${esc(backLabel)}</span>`, onclick: () => Nav.pop() }),
      h('div', { style: { flex: 1 } }), this.status, this.aiBtn,
      h('button.iconbtn', { 'aria-label': 'Flere valg', html: icon('more'), onclick: () => this.moreMenu() }));
    this.offAI = Bus.on('ai', () => this.aiBtn.classList.toggle('hidden', !AI.available));
    const scroll = this.scroll = h('div.scroll.ed-scroll');
    scroll.addEventListener('scroll', () => bar.classList.toggle('scrolled', scroll.scrollTop > 4), { passive: true });
    this.crumbs = h('div.ed-crumbs');
    this.title = h('textarea.ed-title', { rows: 1, placeholder: 'Titel', 'aria-label': 'Titel', enterkeyhint: 'next' });
    this.tags = h('div.ed-tags');
    this.body = h('div.ed-body', { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note', spellcheck: 'true', 'data-ph': 'Begynd at skrive, eller tast / for blokke' });
    this.foot = h('div.ed-foot');
    this.links = h('div.ed-links');
    scroll.append(h('div.ed-wrap', this.crumbs, this.title, this.tags, this.body, this.links, this.foot));
    el.append(bar, scroll);
    this.buildBar();
    this.bind();
  }

  buildBar() {
    const b = (ic, label, fn, cls = '') => {
      const btn = h('button' + cls, { 'aria-label': label, title: label, html: ic.startsWith('<') ? ic : icon(ic, 'sm') });
      btn.addEventListener('pointerdown', e => e.preventDefault());
      btn.addEventListener('click', () => { haptic.tap(); fn(btn); });
      return btn;
    };
    this.ctx = h('div.ctx.hidden');
    this.btnB = b('bold', 'Fed', () => this.inline('bold'));
    this.btnI = b('italic', 'Kursiv', () => this.inline('italic'));
    this.btnU = b('underline', 'Understreg', () => this.inline('underline'));
    this.btnCheck = b('checklist', 'Tjekliste', () => this.toggleList('check'));
    const inner = h('div.inner',
      b('<span style="font:600 17px var(--font-display)">Aa</span>', 'Formatering', () => this.formatSheet()),
      this.btnCheck, b('list', 'Punktliste', () => this.toggleList('ul')),
      h('span.sep'), this.btnB, this.btnI, this.btnU,
      h('span.sep'), b('image', 'Billede', () => this.pickFile('image')), b('clip', 'Vedhæft fil', () => this.pickFile('file')),
      b('table', 'Tabel', () => this.insertTable()), b('link', 'Link til note', () => this.startNoteLink()),
      b('cal', 'Dato på opgave', () => this.dueSheet()),
      AI.available ? b('spark', 'AI', () => AI.editorSheet(this), '.ai') : null,
      h('span.sep'), b('undo', 'Fortryd', () => this.undo()), b('redo', 'Gentag', () => this.redo()),
      b('kbd', 'Skjul tastatur', () => { document.activeElement && document.activeElement.blur(); }));
    this.edbar = h('div.edbar', this.ctx, inner);
    document.body.append(this.edbar);
  }

  /* ---------- load / save ---------- */
  load() {
    const n = this.note;
    this.title.value = n.title || '';
    this.body.innerHTML = n.html && n.html !== '' ? n.html : '<p></p>';
    this.normalize();
    this.hydrate();
    this.autoTitle();
    this.renderMeta();
    this.record(true);
    document.documentElement.style.setProperty('--ed-size', (Store.setting('edSize') || 17) + 'px');
  }
  serialize() {
    const c = this.body.cloneNode(true);
    $$('img[data-blob]', c).forEach(i => { i.removeAttribute('src'); i.classList.remove('loading'); if (!i.className) i.removeAttribute('class'); });
    $$('li.pop', c).forEach(l => l.classList.remove('pop'));
    $$('[class=""]', c).forEach(x => x.removeAttribute('class'));
    let html = c.innerHTML.replace(/\u200b/g, '').replace(/<p><br><\/p>$/, '<p></p>');
    if (html === '<br>' || html === '') html = '<p></p>';
    return html;
  }
  save = debounce(() => {
    const n = this.note; if (!n) return;
    if (this.firstEdit) { this.firstEdit = false; Store.snapshot({ ...n }, 'open'); }
    Store.update(this.id, { title: this.title.value.trim(), html: this.serialize() }, { quiet: true });
    Store.snapshot(this.note, 'auto');
    this.dirtyLocal = false;
    this.renderStatus(); this.renderFoot();
  }, 400);
  changed() { this.dirtyLocal = true; this.status.classList.add('pending'); this.status.querySelector('span').textContent = 'Gemmer…'; this.save(); }
  flush() { this.save.flush(); }

  close() {
    if (this.dirtyLocal) this.flush();
    const n = this.note;
    if (n) {
      const empty = !this.title.value.trim() && !htmlToText(this.serialize()).trim() && !this.body.querySelector('img,.att,table,hr');
      if (empty && n.createdAt > now() - 6 * 3600000) Store.destroy(this.id);
      else Store.snapshot(n, 'close');
    }
    this.offNotes(); this.offSync(); this.offKb(); this.offAI();
    document.removeEventListener('selectionchange', this.onSel);
    this.edbar.classList.remove('on'); setTimeout(() => this.edbar.remove(), 300);
    Pop.close();
    Bus.emit('notes', { id: this.id, type: 'closed' });
  }

  onRemote() {
    if (this.dirtyLocal) return; // local edits win; Sync stores the other version in history
    const n = this.note; if (!n) return;
    const focused = document.activeElement === this.body;
    if (n.html !== this.serialize()) {
      const st = this.scroll.scrollTop; const sel = focused ? this.saveSel() : null;
      this.body.innerHTML = n.html || '<p></p>'; this.hydrate(); this.scroll.scrollTop = st;
      if (sel) try { this.restoreSel(sel); } catch (e) {}
    }
    if (document.activeElement !== this.title) this.title.value = n.title || '';
    this.autoTitle(); this.renderMeta();
  }

  /* ---------- rendering of meta ---------- */
  renderMeta() {
    const n = this.note; if (!n) return;
    this.crumbs.innerHTML = '';
    const path = Store.folderPath(n.folderId);
    const folderBtn = h('button', { html: icon('folder', 'xs') + esc(path.length ? path.map(f => f.name).join(' / ') : 'Ingen mappe'), onclick: async () => { const f = await pickFolder(n.folderId); if (f !== undefined) { Store.update(this.id, { folderId: f }, { touch: false, quiet: true }); this.renderMeta(); } } });
    this.crumbs.append(h('button', { 'aria-label': 'Farve', html: `<i class="stdot st-${n.color || 'yellow'}"></i>Farve`, onclick: () => this.colorPick() }), folderBtn);
    this.el.className = this.el.className.replace(/\bst-\w+/, 'st-' + (n.color || 'yellow'));
    if (n.pinned) this.crumbs.append(h('button', { html: icon('pin', 'xs') + 'Fastgjort', onclick: () => { Store.update(this.id, { pinned: false }, { touch: false, quiet: true }); this.renderMeta(); } }));
    if (n.kind === 'daily' && n.dailyDate) this.crumbs.append(h('button', { html: icon('journal', 'xs') + 'Dagbog' }));
    this.tags.innerHTML = '';
    (n.tags || []).forEach(t => this.tags.append(h('button.tagchip', { text: '#' + t, onclick: () => editTagsAndRefresh(this) })));
    this.tags.append(h('button.tagchip.addtag', { html: icon('tag', 'xs') + ((n.tags || []).length ? '' : 'Tilføj tag'), 'aria-label': 'Tilføj tag', onclick: () => editTagsAndRefresh(this) }));
    this.renderFoot(); this.renderLinks(); this.renderStatus();
  }
  renderStatus() {
    const st = this.status; if (!st) return;
    if (this.dirtyLocal) return;
    const pending = Sync.state === 'syncing' || Sync.state === 'connecting';
    st.classList.toggle('pending', pending);
    st.querySelector('span').textContent = Sync.state === 'local' ? 'Gemt lokalt' : Sync.state === 'offline' ? 'Gemt · offline' : Sync.state === 'error' ? 'Gemt lokalt' : pending ? 'Synkroniserer' : 'Gemt';
  }
  renderFoot() {
    const text = htmlToText(this.serialize()) + ' ' + this.title.value;
    const wc = wordCount(text);
    const n = this.note; if (!n) return;
    this.foot.innerHTML = `<span>${wc.toLocaleString('da-DK')} ord</span><span>${Math.max(1, Math.round(wc / 220))} min. læsning</span><span>${text.replace(/\s/g, '').length.toLocaleString('da-DK')} tegn</span><span>Oprettet ${fmtRel(n.createdAt).toLowerCase()}</span>`;
  }
  renderLinks = debounce(() => {
    this.links.innerHTML = '';
    const back = Search.backlinks(this.id), rel = Search.related(this.id, 3);
    const card = (n, sub) => h('button.linkcard', { onclick: () => { this.flush(); openNote(n.id); } }, h('span', { html: icon(sub ? 'graph' : 'link', 'sm'), style: { color: 'var(--accent)' } }), h('div', { style: { minWidth: 0 } }, h('b', { text: noteTitle(n) }), h('small', { text: Store.d(n).snippet.slice(0, 90) })));
    if (back.length) { this.links.append(h('h4', { text: `Henvisninger hertil · ${back.length}` })); back.slice(0, 8).forEach(n => this.links.append(card(n))); }
    if (rel.length) { this.links.append(h('h4', { style: { marginTop: back.length ? '18px' : 0 }, text: 'Relaterede noter' })); rel.forEach(r => this.links.append(card(r.n, true))); }
  }, 600);

  autoTitle() { this.title.style.height = 'auto'; this.title.style.height = this.title.scrollHeight + 'px'; }

  /** Ensure the body is a list of valid blocks and always ends with a paragraph you can type into. */
  normalize() {
    const b = this.body;
    for (const c of [...b.childNodes]) {
      if (c.nodeType === 3) { if (c.textContent.trim()) { const p = h('p'); c.replaceWith(p); p.append(c); } else c.remove(); }
      else if (c.nodeType === 1 && c.tagName === 'DIV' && !c.classList.contains('att') && !c.classList.contains('tw')) { const p = h('p'); p.innerHTML = c.innerHTML; c.replaceWith(p); }
      else if (c.nodeType === 1 && c.tagName === 'BR') c.remove();
    }
    const last = b.lastElementChild;
    if (!last || !/^(P|H1|H2|H3)$/.test(last.tagName) || last.classList.length) b.append(h('p'));
    $$('ul.checklist > li:not([data-checked])', b).forEach(li => li.setAttribute('data-checked', 'false'));
    $$('p,h1,h2,h3,li,blockquote,td,th', b).forEach(x => { if (!x.childNodes.length) x.append(h('br')); });
    $$('.att,.due', b).forEach(x => x.setAttribute('contenteditable', 'false'));
  }
  hydrate() {
    $$('img[data-blob]', this.body).forEach(img => {
      if (img.getAttribute('src')) return;
      img.classList.add('loading');
      Store.getBlob(img.dataset.blob).then(b => { img.classList.remove('loading'); if (b) img.src = b.dataUrl; else img.alt = 'Billedet er ikke hentet endnu'; });
    });
    $$('.due', this.body).forEach(d => { d.className = 'due ' + dueClass(d.dataset.due); d.textContent = fmtDue(d.dataset.due); });
    $$('a[data-note]', this.body).forEach(a => { const n = Store.get(a.dataset.note); a.classList.toggle('missing', !n || !!n.trashedAt); if (n && !n.trashedAt) a.textContent = noteTitle(n); });
  }

  /* ---------- selection helpers ---------- */
  range() { const s = getSelection(); return s.rangeCount && this.body.contains(s.anchorNode) ? s.getRangeAt(0) : null; }
  block(node) {
    node = node || (this.range() && this.range().startContainer);
    while (node && node !== this.body) { if (node.nodeType === 1 && /^(TD|TH)$/.test(node.tagName)) return node; if (node.nodeType === 1 && node.matches(BLOCK_SEL) && (node.parentNode === this.body || node.tagName === 'LI' || node.parentNode.tagName === 'LI' || node.closest('td,th'))) return node; node = node.parentNode; }
    return null;
  }
  topBlock(node) { while (node && node.parentNode !== this.body) node = node.parentNode; return node; }
  pathOf(node) { const p = []; while (node && node !== this.body) { p.unshift([...node.parentNode.childNodes].indexOf(node)); node = node.parentNode; } return p; }
  nodeAt(path) { let n = this.body; for (const i of path) { if (!n.childNodes[i]) return null; n = n.childNodes[i]; } return n; }
  saveSel() { const r = this.range(); if (!r) return null; return { s: this.pathOf(r.startContainer), so: r.startOffset, e: this.pathOf(r.endContainer), eo: r.endOffset }; }
  restoreSel(sel) {
    if (!sel) return; const s = this.nodeAt(sel.s), e = this.nodeAt(sel.e); if (!s || !e) return;
    const r = document.createRange();
    r.setStart(s, Math.min(sel.so, s.nodeType === 3 ? s.length : s.childNodes.length)); r.setEnd(e, Math.min(sel.eo, e.nodeType === 3 ? e.length : e.childNodes.length));
    const se = getSelection(); se.removeAllRanges(); se.addRange(r);
  }
  focusEnd(node) { const r = document.createRange(); r.selectNodeContents(node); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  textBeforeCaret(block) {
    const r = this.range(); if (!r || !block) return '';
    const pre = document.createRange(); pre.selectNodeContents(block); pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString();
  }

  /* ---------- history (own undo stack; survives custom DOM operations) ---------- */
  record(force = false) {
    const html = this.body.innerHTML; const H = this.hist;
    if (!force && H.states[H.idx] && H.states[H.idx].html === html) return;
    H.states.splice(H.idx + 1); H.states.push({ html, sel: this.saveSel() }); H.idx = H.states.length - 1;
    if (H.states.length > 200) { H.states.shift(); H.idx--; }
  }
  undo() {
    const H = this.hist; if (H.states[H.idx] && H.states[H.idx].html !== this.body.innerHTML) this.record();
    if (H.idx <= 0) return UI.toast('Intet at fortryde');
    H.idx--; this.applyState(H.states[H.idx]);
  }
  redo() { const H = this.hist; if (H.idx >= H.states.length - 1) return; H.idx++; this.applyState(H.states[H.idx]); }
  applyState(st) { this.body.innerHTML = st.html; this.hydrate(); this.body.focus({ preventScroll: true }); try { this.restoreSel(st.sel); } catch (e) {} this.changed(); }

  /* ---------- events ---------- */
  bind() {
    const t = this.title, b = this.body;
    t.addEventListener('input', () => { this.autoTitle(); this.changed(); });
    t.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); b.focus(); const f = b.firstElementChild; if (f) { const r = document.createRange(); r.setStart(f, 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); } }
    });
    t.addEventListener('focus', () => this.showBar(false)); t.addEventListener('blur', () => this.hideBarSoon());
    b.addEventListener('focus', () => this.showBar(true)); b.addEventListener('blur', () => this.hideBarSoon());

    b.addEventListener('beforeinput', e => {
      if (e.inputType === 'historyUndo') { e.preventDefault(); return this.undo(); }
      if (e.inputType === 'historyRedo') { e.preventDefault(); return this.redo(); }
      if (e.inputType === 'insertParagraph' && this.onEnter(e)) return;
      if (e.inputType === 'deleteContentBackward' && this.onBackspace(e)) return;
      const H = this.hist, tnow = now();
      const typing = e.inputType === 'insertText' && e.data && !/\s/.test(e.data);
      if (!typing || tnow - H.lastAt > 1200 || H.lastType !== 'type') this.record();
      H.lastAt = tnow; H.lastType = typing ? 'type' : e.inputType;
    });
    b.addEventListener('input', e => this.onInput(e));
    b.addEventListener('compositionend', () => setTimeout(() => this.afterTyping(), 0));
    b.addEventListener('keydown', e => this.onKey(e));
    b.addEventListener('paste', e => this.onPaste(e));
    b.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); [...e.dataTransfer.files].forEach(f => this.insertFile(f, f.type.startsWith('image/') ? 'image' : 'file')); } });
    b.addEventListener('click', e => this.onClick(e));
    this.onSel = () => this.updateBarState();
    document.addEventListener('selectionchange', this.onSel);
  }

  showBar(body) { clearTimeout(this.hideT); this.barForBody = body; this.edbar.classList.add('on'); this.edbar.querySelector('.inner').style.display = body ? '' : 'none'; this.placeBar(KB.offset || 0); this.updateBarState(); }
  hideBarSoon() { clearTimeout(this.hideT); this.hideT = setTimeout(() => { if (document.activeElement !== this.body && document.activeElement !== this.title && !Sheet.stack.length) { this.edbar.classList.remove('on'); Pop.close(); } }, 200); }
  placeBar(off) {
    this.edbar.style.bottom = (off || 0) + 'px';
    this.edbar.classList.toggle('kb', (off || 0) > 120);
    this.scroll.style.paddingBottom = (off || 0) + 120 + 'px';
  }
  updateBarState() {
    if (!this.edbar.classList.contains('on')) return;
    const r = this.range(); if (!r) return;
    try {
      this.btnB.classList.toggle('on', document.queryCommandState('bold'));
      this.btnI.classList.toggle('on', document.queryCommandState('italic'));
      this.btnU.classList.toggle('on', document.queryCommandState('underline'));
    } catch (e) {}
    const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
    const cell = node.closest && node.closest('td,th'); const li = node.closest && node.closest('ul.checklist > li');
    this.btnCheck.classList.toggle('on', !!li);
    const ctx = this.ctx; ctx.innerHTML = '';
    const cb = (label, fn) => { const x = h('button', { text: label }); x.addEventListener('pointerdown', e => e.preventDefault()); x.addEventListener('click', () => { haptic.tap(); fn(); }); return x; };
    if (cell && this.body.contains(cell)) {
      ctx.append(cb('+ Række', () => this.tableOp('addRow', cell)), cb('+ Kolonne', () => this.tableOp('addCol', cell)), cb('− Række', () => this.tableOp('delRow', cell)), cb('− Kolonne', () => this.tableOp('delCol', cell)), cb('Slet tabel', () => this.tableOp('delTable', cell)));
    } else if (li) {
      ctx.append(cb(li.querySelector('.due') ? 'Skift dato' : 'Tilføj dato', () => this.dueSheet()), cb('I dag', () => this.setDue(ymd())), cb('I morgen', () => this.setDue(ymd(addDays(new Date(), 1)))), cb('Ryk ind', () => this.indent(li)), cb('Ryk ud', () => this.outdent()));
    } else if (node.closest && node.closest('li')) {
      const l = node.closest('li'); ctx.append(cb('Ryk ind', () => this.indent(l)), cb('Ryk ud', () => this.outdent()));
    }
    ctx.classList.toggle('hidden', !ctx.children.length);
  }

  onInput(e) {
    const b = this.body;
    if (!b.firstElementChild || b.innerHTML === '<br>') { b.innerHTML = '<p><br></p>'; this.focusEnd(b.firstChild); }
    const blk = this.block();
    if (e.inputType === 'insertParagraph' && blk) {
      if (blk.tagName === 'LI' && blk.parentNode.classList.contains('checklist')) {
        blk.setAttribute('data-checked', 'false');
        const prev = blk.previousElementSibling; if (prev && !prev.textContent.trim() && !prev.querySelector('.due')) { /* native handles exiting */ }
      }
      // a due chip should not travel into a new item that has no text before it
      if (blk.tagName === 'LI') { const due = blk.querySelector(':scope > .due'); if (due && !blk.textContent.replace(due.textContent, '').trim()) due.remove(); }
      if (/^H[1-3]$/.test(blk.tagName) && !blk.textContent.trim() && blk.previousElementSibling && /^H[1-3]$/.test(blk.previousElementSibling.tagName)) { const p = h('p', h('br')); blk.replaceWith(p); this.focusEnd(p); }
    }
    if (!e.isComposing && /^insert(Text|CompositionText|ReplacementText)$/.test(e.inputType)) this.afterTyping();
    else if (Pop.cur && this.popTrack) this.popTrack();
    this.changed();
  }
  /** Runs typing shortcuts from the text before the caret, so it works for hardware keys and Android IMEs alike. */
  afterTyping() {
    const blk = this.block(); if (!blk) return;
    const before = this.textBeforeCaret(blk); const last = before.slice(-1);
    if (last === ' ' || last === '\u00a0') this.mdShortcut(blk);
    else if (/[*_~`=]/.test(last)) {
      if (blk.tagName === 'P' && before === '```') { this.record(); blk.innerHTML = '<br>'; this.setBlock('pre'); return; }
      this.inlineShortcut();
    }
    if (last === '/') this.maybeSlash(blk);
    if (before.endsWith('[[') && !this.popTrack) this.startNoteLink(true);
    if (Pop.cur && this.popTrack) this.popTrack();
  }

  mdShortcut(blk) {
    const before = this.textBeforeCaret(blk).replace(/ /g, ' ');
    const rules = [
      [/^#\s$/, () => this.setBlock('h1')], [/^##\s$/, () => this.setBlock('h2')], [/^###\s$/, () => this.setBlock('h3')],
      [/^[-*•]\s$/, () => this.toggleList('ul')], [/^1[.)]\s$/, () => this.toggleList('ol')],
      [/^\[\s?\]\s$/, () => this.toggleList('check')], [/^\[x\]\s$/i, () => { this.toggleList('check'); const li = this.block(); li && li.setAttribute('data-checked', 'true'); }],
      [/^>\s$/, () => this.setBlock('blockquote')], [/^---\s$/, () => this.insertHr()],
    ];
    if (blk.tagName === 'PRE') return;
    for (const [re, fn] of rules) {
      if (re.test(before)) {
        if (blk.tagName === 'LI' && !/^(\[|\[x)/i.test(before)) return;
        this.record();
        // remove the typed marker
        const r = this.range(); const del = document.createRange(); del.selectNodeContents(blk); del.setEnd(r.startContainer, r.startOffset);
        del.deleteContents();
        if (!blk.textContent && !blk.querySelector('br,img')) blk.append(h('br'));
        const rr = document.createRange(); rr.setStart(blk, 0); rr.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(rr);
        fn(); haptic.tap(); return;
      }
    }
  }

  /** **fed**, *kursiv*, ~~streg~~, `kode` and ==markering== convert as you type the closing marker. */
  inlineShortcut() {
    const r = this.range(); if (!r || !r.collapsed) return;
    const node = r.startContainer; if (node.nodeType !== 3 || node.parentNode.closest('pre,code')) return;
    const before = node.textContent.slice(0, r.startOffset);
    const rules = [[/\*\*([^*\s][^*]*?)\*\*$/, 'strong'], [/__([^_\s][^_]*?)__$/, 'strong'], [/(?<!\*)\*([^*\s][^*]*?)\*$/, 'em'], [/~~([^~\s][^~]*?)~~$/, 's'], [/`([^`]+)`$/, 'code'], [/==([^=\s][^=]*?)==$/, 'mark']];
    for (const [re, tag] of rules) {
      const m = before.match(re); if (!m) continue;
      const full = m[0];
      const start = r.startOffset - full.length;
      this.record();
      const rng = document.createRange(); rng.setStart(node, start); rng.setEnd(node, r.startOffset); rng.deleteContents();
      const el = document.createElement(tag); if (tag === 'mark') el.className = 'hl-yellow'; el.textContent = m[1];
      rng.insertNode(el);
      const after = document.createTextNode('\u200b'); el.after(after);
      const c = document.createRange(); c.setStart(after, 1); c.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(c);
      return;
    }
  }

  onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (Pop.cur && this.popKeys && this.popKeys(e)) return;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
      if (k === 'y') { e.preventDefault(); return this.redo(); }
      if (k === 'b') { e.preventDefault(); return this.inline('bold'); }
      if (k === 'i') { e.preventDefault(); return this.inline('italic'); }
      if (k === 'u') { e.preventDefault(); return this.inline('underline'); }
      if (k === 'k') { e.preventDefault(); e.stopPropagation(); return this.linkSheet(); }
      if (k === 'enter') { const li = this.block(); if (li && li.closest('ul.checklist')) { e.preventDefault(); this.toggleCheck(li.closest('li')); } return; }
      if (e.shiftKey && k === '7') { e.preventDefault(); return this.toggleList('ol'); }
      if (e.shiftKey && k === '8') { e.preventDefault(); return this.toggleList('ul'); }
      if (e.shiftKey && k === '9') { e.preventDefault(); return this.toggleList('check'); }
    }
    const blk = this.block();
    if (e.key === 'Tab' && blk) {
      const li = blk.closest('li');
      if (li) { e.preventDefault(); return e.shiftKey ? this.outdent() : this.indent(li); }
      if (blk.closest('td,th')) { e.preventDefault(); const cells = $$('td,th', blk.closest('table')); const i = cells.indexOf(blk.closest('td,th')); const nx = cells[i + (e.shiftKey ? -1 : 1)]; if (nx) this.focusEnd(nx); else if (!e.shiftKey) { this.tableOp('addRow', blk.closest('td,th')); } return; }
      if (blk.tagName === 'PRE') { e.preventDefault(); document.execCommand('insertText', false, '  '); return; }
    }
  }

  /** Enter (from keydown or an IME's beforeinput). Returns true when handled. */
  onEnter(e) {
    if (Pop.cur && this.popChoose) { e.preventDefault(); this.popChoose(); return true; }
    const blk = this.block(); if (!blk) return false;
    if (blk.tagName === 'PRE') {
      e.preventDefault(); this.record();
      $$('br', blk).forEach(br => br.replaceWith('\n'));
      blk.normalize();
      const r = this.range(); if (!r) return true; r.deleteContents();
      const before = this.textBeforeCaret(blk), all = blk.textContent;
      const after = all.slice(before.length);
      if (before.endsWith('\n') && !after.replace(/\n/g, '')) {
        blk.textContent = all.replace(/\n+$/, '');
        const p = h('p', h('br')); blk.after(p); this.focusEnd(p); this.changed(); return true;
      }
      const tn = document.createTextNode('\n'); r.insertNode(tn);
      if (!after) tn.after(document.createTextNode('\n'));
      const c = document.createRange(); c.setStartAfter(tn); c.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(c);
      this.changed(); return true;
    }
    if (blk.closest('td,th')) { e.preventDefault(); document.execCommand('insertLineBreak'); return true; }
    if (blk.tagName === 'BLOCKQUOTE' && !blk.textContent.trim()) { e.preventDefault(); this.record(); const p = h('p', h('br')); blk.replaceWith(p); this.focusEnd(p); this.changed(); return true; }
    return false;
  }
  /** Backspace at the start of a block. Returns true when handled. */
  onBackspace(e) {
    const blk = this.block(); const r = this.range();
    if (!blk || !r || !r.collapsed || this.textBeforeCaret(blk) !== '') return false;
    if (/^(H1|H2|H3|BLOCKQUOTE|PRE)$/.test(blk.tagName)) { e.preventDefault(); this.record(); this.setBlock('p', blk); this.changed(); return true; }
    const prev = blk.previousElementSibling;
    if (prev && prev.matches('div.att,div.tw,hr') && blk.parentNode === this.body) { e.preventDefault(); this.record(); prev.remove(); this.changed(); return true; }
    return false;
  }

  onPaste(e) {
    const cd = e.clipboardData; if (!cd) return;
    const files = [...cd.files || []];
    if (files.length) { e.preventDefault(); files.forEach(f => this.insertFile(f, f.type.startsWith('image/') ? 'image' : 'file')); return; }
    const html = cd.getData('text/html'), text = cd.getData('text/plain');
    e.preventDefault(); this.record();
    const blk = this.block();
    if (blk && blk.tagName === 'PRE') { document.execCommand('insertText', false, text); return; }
    let out;
    if (html) out = sanitizeHtml(html);
    else if (/(^|\n)(#{1,3} |[-*] |\d+\. |> |```|- \[[ x]\] )/.test(text) || /\*\*[^*]+\*\*/.test(text)) out = MD.toHtml(text);
    else if (/^https?:\/\/\S+$/.test(text.trim())) out = `<a href="${esc(text.trim())}" target="_blank" rel="noopener">${esc(text.trim())}</a>`;
    else { document.execCommand('insertText', false, text); return; }
    // single paragraph → insert inline content only
    const t = document.createElement('template'); t.innerHTML = out;
    if (t.content.children.length === 1 && t.content.firstElementChild.tagName === 'P') out = t.content.firstElementChild.innerHTML;
    document.execCommand('insertHTML', false, out);
    this.adoptDataImages(); this.normalize(); this.hydrate(); this.changed();
  }
  /** Pasted data: images become stored blobs so notes stay small and sync well. */
  async adoptDataImages() {
    for (const img of $$('img[src^="data:"]:not([data-blob])', this.body)) {
      try {
        const blob = dataUrlToBlob(img.src); const f = new File([blob], 'billede', { type: blob.type });
        const b = await makeImageBlob(f); img.setAttribute('data-blob', b.id); img.src = b.dataUrl;
      } catch (e) { img.remove(); }
    }
    this.changed();
  }

  onClick(e) {
    const t = e.target;
    const li = t.closest('ul.checklist > li');
    if (li && this.body.contains(li)) {
      const x = e.clientX - li.getBoundingClientRect().left;
      if (x < 30 && e.clientY - li.getBoundingClientRect().top < 30) { e.preventDefault(); this.toggleCheck(li); return; }
    }
    const due = t.closest('.due'); if (due) { e.preventDefault(); const l = due.closest('li'); if (l) this.focusEnd(l); this.dueSheet(due); return; }
    const a = t.closest('a');
    if (a && this.body.contains(a)) {
      e.preventDefault();
      if (a.dataset.note) { const n = Store.get(a.dataset.note); if (n && !n.trashedAt) { this.flush(); openNote(n.id); } else this.missingLink(a); return; }
      if (a.classList.contains('missing')) return this.missingLink(a);
      return this.linkMenu(a);
    }
    const att = t.closest('.att'); if (att) { e.preventDefault(); return this.attachmentSheet(att); }
    if (t.tagName === 'IMG' && t.dataset.blob) return this.imageSheet(t);
  }

  toggleCheck(li) {
    this.record();
    const on = li.getAttribute('data-checked') !== 'true';
    li.setAttribute('data-checked', on ? 'true' : 'false');
    li.classList.add('pop'); setTimeout(() => li.classList.remove('pop'), 260);
    on ? haptic.ok() : haptic.tap();
    this.changed();
  }

  /* ---------- formatting ---------- */
  inline(cmd) { this.record(); document.execCommand(cmd); this.changed(); this.updateBarState(); }
  setBlock(tag, blk) {
    blk = blk || this.block(); if (!blk) return;
    this.record();
    const cur = blk.tagName.toLowerCase();
    if (cur === tag && tag !== 'p') tag = 'p';
    if (blk.tagName === 'LI') {
      // turn list item into a block of its own
      const list = blk.parentNode; const nb = h(tag); nb.innerHTML = blk.innerHTML; $$('ul,ol,.due', nb).forEach(x => x.remove());
      if (!nb.textContent && !nb.querySelector('br')) nb.append(h('br'));
      const items = [...list.children]; const i = items.indexOf(blk);
      const after = items.slice(i + 1);
      if (after.length) { const l2 = list.cloneNode(false); after.forEach(x => l2.append(x)); list.after(l2); }
      list.after(nb); blk.remove(); if (!list.children.length) list.remove();
      this.focusEnd(nb); this.changed(); return;
    }
    const nb = h(tag);
    if (tag === 'pre') nb.textContent = blk.textContent; else if (cur === 'pre') nb.textContent = blk.textContent; else nb.innerHTML = blk.innerHTML;
    if (!nb.textContent && !nb.querySelector('br,img')) nb.append(h('br'));
    const sel = this.saveSel();
    blk.replaceWith(nb);
    try { this.restoreSel(sel); } catch (e) { this.focusEnd(nb); }
    if (!this.range()) this.focusEnd(nb);
    this.normalize(); this.changed();
  }
  toggleList(kind) {
    const blk = this.block(); if (!blk) { this.body.focus(); return; }
    this.record();
    const li = blk.closest('li'); const list = li && li.parentNode;
    const want = kind === 'ol' ? 'OL' : 'UL', check = kind === 'check';
    if (list && this.body.contains(list)) {
      const isCheck = list.classList.contains('checklist');
      if (list.tagName === want && isCheck === check) { this.setBlock('p', li); return; }
      // convert the whole list
      const nl = h(want.toLowerCase() + (check ? '.checklist' : ''));
      [...list.children].forEach(x => { if (check) { if (!x.hasAttribute('data-checked')) x.setAttribute('data-checked', 'false'); } else { x.removeAttribute('data-checked'); $$(':scope > .due', x).forEach(d => d.remove()); } nl.append(x); });
      const sel = this.saveSel(); list.replaceWith(nl); try { this.restoreSel(sel); } catch (e) {}
      this.changed(); return;
    }
    const target = blk.closest('td,th') ? null : this.topBlock(blk);
    if (!target || /^(DIV|HR|PRE)$/.test(target.tagName)) return;
    const nl = h(want.toLowerCase() + (check ? '.checklist' : ''));
    const item = h('li'); if (check) item.setAttribute('data-checked', 'false');
    item.innerHTML = target.innerHTML || '<br>';
    nl.append(item);
    // merge with neighbouring list of the same kind
    const prev = target.previousElementSibling, next = target.nextElementSibling;
    const same = el => el && el.tagName === want && el.classList.contains('checklist') === check;
    const sel = this.saveSel();
    target.replaceWith(nl);
    if (same(prev)) { prev.append(item); nl.remove(); if (same(next)) { [...next.children].forEach(x => prev.append(x)); next.remove(); } }
    else if (same(next)) { next.prepend(item); nl.remove(); }
    this.focusEnd(item);
    this.changed();
  }
  indent(li) {
    const prev = li.previousElementSibling; if (!prev) return;
    this.record();
    const parent = li.parentNode;
    let sub = [...prev.children].reverse().find(x => x.tagName === parent.tagName);
    if (!sub) { sub = document.createElement(parent.tagName.toLowerCase()); if (parent.classList.contains('checklist')) sub.className = 'checklist'; prev.append(sub); }
    sub.append(li); this.focusEnd(li); this.changed();
  }
  outdent() {
    const blk = this.block(); const li = blk && blk.closest('li'); if (!li) return;
    const list = li.parentNode, parentLi = list.parentNode.closest && list.parentNode.closest('li');
    this.record();
    if (parentLi && this.body.contains(parentLi)) {
      const after = [...list.children].slice([...list.children].indexOf(li) + 1);
      if (after.length) { const nl = list.cloneNode(false); after.forEach(x => nl.append(x)); li.append(nl); }
      parentLi.after(li); if (!list.children.length) list.remove();
      this.focusEnd(li);
    } else { this.setBlock('p', li); return; }
    this.changed();
  }
  insertHr() { const blk = this.topBlock(this.block()); if (!blk) return; const hr = h('hr'); const p = h('p', h('br')); if (!blk.textContent.trim() && blk.tagName === 'P') { blk.replaceWith(hr); hr.after(p); } else { blk.after(hr); hr.after(p); } this.focusEnd(p); this.changed(); }
  wrapInline(tag, cls) {
    const r = this.range(); if (!r || r.collapsed) return UI.toast('Markér tekst først');
    this.record();
    // remove existing spans/marks of same family inside selection
    const frag = r.extractContents();
    $$(tag === 'mark' ? 'mark' : 'span[class^="c-"]', frag).forEach(x => x.replaceWith(...x.childNodes));
    if (cls) { const w = document.createElement(tag); w.className = cls; w.append(frag); r.insertNode(w); const s = getSelection(); s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(w); s.addRange(nr); }
    else { const tmp = document.createElement('span'); tmp.append(frag); r.insertNode(tmp); const kids = [...tmp.childNodes]; tmp.replaceWith(...kids); }
    // clean up wrappers that the selection sat inside
    this.changed();
  }
  clearFormat() { this.record(); document.execCommand('removeFormat'); const r = this.range(); if (r) { this.wrapInline('mark', null); } this.changed(); }

  formatSheet() {
    const sel = this.saveSel(); const blk = this.block(); const cur = blk ? (blk.closest('ul.checklist') ? 'check' : blk.closest('ol') ? 'ol' : blk.closest('ul') ? 'ul' : blk.tagName.toLowerCase()) : 'p';
    Sheet.open({ title: 'Formatering', onClose: () => { this.body.focus({ preventScroll: true }); try { this.restoreSel(sel); } catch (e) {} }, build: (body, sheet) => {
      const act = (fn) => () => { this.body.focus({ preventScroll: true }); try { this.restoreSel(sel); } catch (e) {} fn(); haptic.tap(); sheet.close(); };
      body.append(h('div.fmt-row',
        h('button' + (cur === 'h1' ? '.on' : ''), { style: { font: '600 19px var(--font-display)' }, text: 'Titel', onclick: act(() => this.setBlock('h1')) }),
        h('button' + (cur === 'h2' ? '.on' : ''), { style: { font: '600 16px var(--font-display)' }, text: 'Overskrift', onclick: act(() => this.setBlock('h2')) }),
        h('button' + (cur === 'h3' ? '.on' : ''), { style: { fontWeight: 700 }, text: 'Under', onclick: act(() => this.setBlock('h3')) }),
        h('button' + (cur === 'p' ? '.on' : ''), { text: 'Brødtekst', onclick: act(() => this.setBlock('p')) })));
      body.append(h('div.fmt-grid',
        h('button', { 'aria-label': 'Fed', html: icon('bold', 'sm'), onclick: act(() => this.inline('bold')) }),
        h('button', { 'aria-label': 'Kursiv', html: icon('italic', 'sm'), onclick: act(() => this.inline('italic')) }),
        h('button', { 'aria-label': 'Understreg', html: icon('underline', 'sm'), onclick: act(() => this.inline('underline')) }),
        h('button', { 'aria-label': 'Gennemstreg', html: icon('strike', 'sm'), onclick: act(() => this.inline('strikeThrough')) }),
        h('button' + (cur === 'ul' ? '.on' : ''), { 'aria-label': 'Punktliste', html: icon('list', 'sm'), onclick: act(() => this.toggleList('ul')) }),
        h('button' + (cur === 'ol' ? '.on' : ''), { 'aria-label': 'Nummereret liste', html: icon('olist', 'sm'), onclick: act(() => this.toggleList('ol')) }),
        h('button' + (cur === 'check' ? '.on' : ''), { 'aria-label': 'Tjekliste', html: icon('checklist', 'sm'), onclick: act(() => this.toggleList('check')) }),
        h('button' + (cur === 'blockquote' ? '.on' : ''), { 'aria-label': 'Citat', html: icon('quote', 'sm'), onclick: act(() => this.setBlock('blockquote')) }),
        h('button' + (cur === 'pre' ? '.on' : ''), { 'aria-label': 'Kodeblok', html: icon('code', 'sm'), onclick: act(() => this.setBlock('pre')) }),
        h('button', { 'aria-label': 'Link', html: icon('link', 'sm'), onclick: act(() => this.linkSheet()) }),
        h('button', { 'aria-label': 'Skillelinje', html: icon('hr', 'sm'), onclick: act(() => this.insertHr()) }),
        h('button', { 'aria-label': 'Ryd formatering', text: 'Ryd', onclick: act(() => { this.record(); document.execCommand('removeFormat'); this.changed(); }) })));
      body.append(h('div.fmt-label', { text: 'Tekstfarve' }));
      const tc = h('div.swatches');
      [['', 'var(--ink)', 'Standard'], ['c-red', 'var(--c-red)', 'Rød'], ['c-orange', 'var(--c-orange)', 'Orange'], ['c-green', 'var(--c-green)', 'Grøn'], ['c-blue', 'var(--c-blue)', 'Blå'], ['c-purple', 'var(--c-purple)', 'Lilla'], ['c-gray', 'var(--c-gray)', 'Grå']]
        .forEach(([c, col, l]) => tc.append(h('button.swatch', { style: { background: col }, 'aria-label': l, title: l, onclick: act(() => this.wrapInline('span', c || null)) })));
      body.append(tc, h('div.fmt-label', { text: 'Fremhævning' }));
      const hc = h('div.swatches');
      [['', 'var(--fill)', 'Ingen'], ['hl-yellow', 'var(--hl-yellow)', 'Gul'], ['hl-green', 'var(--hl-green)', 'Grøn'], ['hl-blue', 'var(--hl-blue)', 'Blå'], ['hl-pink', 'var(--hl-pink)', 'Lyserød'], ['hl-orange', 'var(--hl-orange)', 'Orange']]
        .forEach(([c, col, l]) => hc.append(h('button.swatch', { style: { background: col, border: '1px solid var(--line)' }, 'aria-label': l, title: l, onclick: act(() => this.wrapInline('mark', c || null)) })));
      body.append(hc);
    } });
  }

  /* ---------- links ---------- */
  linkSheet() {
    const sel = this.saveSel(); const r = this.range(); const selected = r ? r.toString() : '';
    Sheet.open({ title: 'Indsæt link', onClose: () => {}, build: (body, sheet) => {
      const url = h('input.input#link-url', { placeholder: 'https://', type: 'url', autocapitalize: 'off', value: /^https?:/.test(selected) ? selected : '' });
      const txt = h('input.input#link-text', { placeholder: 'Tekst (valgfri)', value: /^https?:/.test(selected) ? '' : selected });
      body.append(h('div.field', h('label', { for: 'link-url', text: 'Adresse' }), url), h('div.field', h('label', { for: 'link-text', text: 'Vist tekst' }), txt),
        h('div.sheet-actions', h('button.btn', { text: 'Indsæt', onclick: () => {
          let u = url.value.trim(); if (!u) return; if (!/^(https?:|mailto:)/.test(u)) u = 'https://' + u;
          sheet.close(); this.body.focus({ preventScroll: true }); try { this.restoreSel(sel); } catch (e) {}
          this.record();
          const label = txt.value.trim() || selected || u;
          document.execCommand('insertHTML', false, `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>&nbsp;`);
          this.changed();
        } })));
      setTimeout(() => url.focus(), 300);
    } });
  }
  linkMenu(a) {
    Sheet.open({ title: a.textContent, build: (body, sheet) => {
      body.append(h('div', { style: { fontSize: '13px', color: 'var(--ink-3)', margin: '-6px 0 12px', wordBreak: 'break-all' }, text: a.href }));
      const list = h('div.menu-list');
      list.append(h('a.mi', { href: a.href, target: '_blank', rel: 'noopener', style: { color: 'inherit', textDecoration: 'none' }, html: icon('share') + '<span>Åbn link</span>', onclick: () => sheet.close() }));
      list.append(h('button.mi', { html: icon('copy') + '<span>Kopiér adresse</span>', onclick: () => { navigator.clipboard.writeText(a.href).then(() => UI.toast('Kopieret'), () => UI.toast('Kunne ikke kopiere')); sheet.close(); } }));
      list.append(h('button.mi.danger', { html: icon('close') + '<span>Fjern link</span>', onclick: () => { this.record(); a.replaceWith(...a.childNodes); this.changed(); sheet.close(); } }));
      body.append(list);
    } });
  }
  async missingLink(a) {
    const title = a.dataset.title || a.textContent;
    if (await UI.confirm({ title: 'Noten findes ikke', text: `Vil du oprette en ny note med titlen "${title}"?`, ok: 'Opret note' })) {
      const n = Store.create({ title, folderId: this.note.folderId });
      a.dataset.note = n.id; a.classList.remove('missing'); a.removeAttribute('data-title'); this.changed(); this.flush(); openNote(n.id);
    }
  }

  /* ---------- slash menu & [[note link]] popovers ---------- */
  caretRect() { const r = this.range(); if (!r) return null; const rr = r.cloneRange(); rr.collapse(true); let rect = rr.getBoundingClientRect(); if (!rect.height) { const b = this.block(); rect = b ? b.getBoundingClientRect() : this.body.getBoundingClientRect(); } return rect; }
  maybeSlash(blk) {
    const before = this.textBeforeCaret(blk);
    if (!/(^|\s)\/$/.test(before)) return;
    const startSel = this.range().cloneRange(); startSel.setStart(startSel.startContainer, Math.max(0, startSel.startOffset - 1));
    const items = [
      ['H1', 'Titel', 'Stor overskrift', () => this.setBlock('h1')], ['H2', 'Overskrift', 'Mellemoverskrift', () => this.setBlock('h2')], ['H3', 'Underoverskrift', 'Lille overskrift', () => this.setBlock('h3')],
      ['☐', 'Tjekliste', 'Opgaver med afkrydsning', () => this.toggleList('check')], ['•', 'Punktliste', 'Simpel liste', () => this.toggleList('ul')], ['1.', 'Nummereret liste', 'Trin i rækkefølge', () => this.toggleList('ol')],
      ['"', 'Citat', 'Fremhævet citat', () => this.setBlock('blockquote')], ['{}', 'Kode', 'Kodeblok', () => this.setBlock('pre')],
      ['▦', 'Tabel', '3 × 3 tabel', () => this.insertTable()], ['▣', 'Billede', 'Fra kamera eller fotos', () => this.pickFile('image')], ['⎘', 'Fil', 'Vedhæft en fil', () => this.pickFile('file')],
      ['—', 'Skillelinje', 'Vandret linje', () => this.insertHr()], ['↗', 'Link til note', 'Forbind to noter', () => this.startNoteLink()], ['◷', 'Dato', 'Forfaldsdato på opgave', () => this.dueSheet()],
      ['T', 'I dag', fmtLongDate(), () => document.execCommand('insertText', false, fmtLongDate().replace(/^./, c => c.toUpperCase()))],
    ];
    if (AI.available) items.push(['✦', 'Spørg AI', 'Skriv, opsummér eller omskriv', () => AI.editorSheet(this)]);
    this.openPicker(startSel, '/', q => items.filter(it => !q || norm(it[1] + ' ' + it[2]).includes(norm(q))).map(it => ({ k: it[0], label: it[1], sub: it[2], run: it[3] })), 'Blokke');
  }
  startNoteLink(typed = false) {
    let start;
    if (typed) { start = this.range().cloneRange(); start.setStart(start.startContainer, Math.max(0, start.startOffset - 2)); }
    else { this.body.focus({ preventScroll: true }); this.record(); document.execCommand('insertText', false, '[['); start = this.range().cloneRange(); start.setStart(start.startContainer, Math.max(0, start.startOffset - 2)); }
    this.openPicker(start, '[[', q => {
      const res = (q ? Search.run(q).map(r => r.n) : Store.active()).filter(n => n.id !== this.id).slice(0, 7)
        .map(n => ({ k: '↗', label: noteTitle(n), sub: fmtRel(n.updatedAt), run: () => this.insertNoteLink(n) }));
      if (q) res.push({ k: '+', label: `Opret "${q}"`, sub: 'Ny note med link', run: () => { const n = Store.create({ title: q, folderId: this.note.folderId }); this.insertNoteLink(n); } });
      return res;
    }, 'Link til note');
  }
  insertNoteLink(n) { document.execCommand('insertHTML', false, `<a class="wl" data-note="${n.id}" href="#">${esc(noteTitle(n))}</a>&nbsp;`); this.changed(); this.renderLinks(); }

  openPicker(startRange, trigger, getItems, header) {
    let idx = 0, items = [];
    const startNode = startRange.startContainer, startOff = startRange.startOffset;
    const query = () => {
      const r = this.range(); if (!r || !this.body.contains(startNode)) return null;
      const q = document.createRange(); try { q.setStart(startNode, startOff); q.setEnd(r.startContainer, r.startOffset); } catch (e) { return null; }
      const s = q.toString(); if (!s.startsWith(trigger)) return null; const rest = s.slice(trigger.length);
      if (/\n/.test(rest) || rest.length > 40 || (trigger === '/' && /\s{2}/.test(rest))) return null;
      return rest;
    };
    const draw = () => {
      const q = query(); if (q == null) return close();
      items = getItems(q); if (!items.length) return close();
      idx = Math.min(idx, items.length - 1);
      const rect = this.caretRect();
      const el = Pop.open(rect, el => {
        el.append(h('div.ph', { text: header }));
        items.forEach((it, i) => {
          const b = h('button.pi' + (i === idx ? '.on' : ''), { html: `<span class="k">${esc(it.k)}</span><span>${esc(it.label)}<small>${esc(it.sub || '')}</small></span>` });
          b.addEventListener('pointerdown', e => e.preventDefault());
          b.addEventListener('click', () => choose(i));
          el.append(b);
        });
      });
      el.querySelector('.pi.on')?.scrollIntoView({ block: 'nearest' });
    };
    const choose = (i) => {
      const it = items[i]; if (!it) return;
      // delete the trigger and query text
      const r = this.range(); const del = document.createRange();
      try { del.setStart(startNode, startOff); del.setEnd(r.startContainer, r.startOffset); del.deleteContents(); } catch (e) {}
      close(); haptic.tap(); this.record(); it.run(); this.changed();
    };
    const close = () => { Pop.close(); this.popTrack = null; this.popKeys = null; this.popChoose = null; };
    this.popTrack = draw; this.popChoose = () => choose(idx);
    this.popKeys = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; draw(); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; draw(); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(idx); return true; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return true; }
      return false;
    };
    draw();
  }

  /* ---------- tables ---------- */
  insertTable() {
    const blk = this.topBlock(this.block()) || this.body.lastElementChild; this.record();
    const tw = h('div.tw'); tw.innerHTML = '<table><thead><tr><th><br></th><th><br></th><th><br></th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table>';
    if (blk && blk.tagName === 'P' && !blk.textContent.trim()) blk.replaceWith(tw); else if (blk) blk.after(tw); else this.body.append(tw);
    if (!tw.nextElementSibling) tw.after(h('p', h('br')));
    this.focusEnd(tw.querySelector('th')); this.changed();
  }
  tableOp(op, cell) {
    const table = cell.closest('table'); const tr = cell.closest('tr'); const col = [...tr.children].indexOf(cell); this.record();
    if (op === 'addRow') { const nr = h('tr'); for (let i = 0; i < tr.children.length; i++) nr.append(h('td', h('br'))); (tr.parentNode.tagName === 'THEAD' ? table.tBodies[0] || table.createTBody() : tr.parentNode).insertBefore(nr, tr.parentNode.tagName === 'THEAD' ? (table.tBodies[0].firstChild) : tr.nextSibling); this.focusEnd(nr.firstChild); }
    if (op === 'addCol') { $$('tr', table).forEach(r => { const c = h(r.parentNode.tagName === 'THEAD' ? 'th' : 'td', h('br')); r.children[col] ? r.children[col].after(c) : r.append(c); }); }
    if (op === 'delRow') { if ($$('tbody tr', table).length <= 1 && tr.parentNode.tagName === 'TBODY') return UI.toast('En tabel skal have mindst én række'); if (tr.parentNode.tagName === 'THEAD') return UI.toast('Overskriftsrækken kan ikke slettes'); const nx = tr.nextElementSibling || tr.previousElementSibling; tr.remove(); nx && this.focusEnd(nx.children[Math.min(col, nx.children.length - 1)]); }
    if (op === 'delCol') { if (tr.children.length <= 1) return this.tableOp('delTable', cell); $$('tr', table).forEach(r => r.children[col] && r.children[col].remove()); }
    if (op === 'delTable') { const tw = table.closest('.tw') || table; const p = h('p', h('br')); tw.replaceWith(p); this.focusEnd(p); }
    this.changed(); this.updateBarState();
  }

  /* ---------- due dates on checklist items ---------- */
  dueSheet(chip) {
    const blk = this.block(); let li = chip ? chip.closest('li') : blk && blk.closest('ul.checklist > li');
    if (!li) {
      // not in a checklist: turn the line into a task first
      if (!blk) return UI.toast('Sæt markøren i en linje først');
      this.toggleList('check'); li = this.block() && this.block().closest('li'); if (!li) return;
    }
    const cur = li.querySelector(':scope > .due');
    Sheet.open({ title: 'Forfaldsdato', build: (body, sheet) => {
      const set = (d) => { sheet.close(); this.setDue(d, li); };
      const list = h('div.menu-list');
      const fri = (() => { let d = new Date(); do d = addDays(d, 1); while (d.getDay() !== 5); return d; })();
      const mon = (() => { let d = new Date(); do d = addDays(d, 1); while (d.getDay() !== 1); return d; })();
      [['I dag', new Date()], ['I morgen', addDays(new Date(), 1)], [`Fredag ${fri.getDate()}. ${DA_MON_S[fri.getMonth()]}`, fri], [`Næste uge (mandag ${mon.getDate()}. ${DA_MON_S[mon.getMonth()]})`, mon]]
        .forEach(([l, d]) => list.append(h('button.mi', { html: icon('cal') + `<span>${l}</span>`, onclick: () => set(ymd(d)) })));
      const inp = h('input.input#due-date', { type: 'date', value: cur ? cur.dataset.due : ymd(addDays(new Date(), 1)) });
      body.append(list, h('div.field', { style: { marginTop: '14px' } }, h('label', { for: 'due-date', text: 'Vælg dato' }), inp),
        h('div.sheet-actions', cur ? h('button.btn.ghost', { text: 'Fjern dato', onclick: () => set(null) }) : null, h('button.btn', { text: 'Sæt dato', onclick: () => inp.value && set(inp.value) })));
    } });
  }
  setDue(d, li) {
    li = li || (this.block() && this.block().closest('ul.checklist > li'));
    if (!li) return this.dueSheet();
    this.record();
    li.querySelector(':scope > .due')?.remove();
    if (d) {
      const t = document.createElement('template'); t.innerHTML = dueChip(d);
      const sub = li.querySelector(':scope > ul, :scope > ol');
      sub ? sub.before(t.content.firstChild) : li.append(t.content.firstChild);
      haptic.ok();
    }
    this.changed(); this.updateBarState();
  }

  /* ---------- images & files ---------- */
  pickFile(kind) {
    const sel = this.saveSel();
    const inp = h('input', { type: 'file', accept: kind === 'image' ? 'image/*' : '', multiple: true, style: { display: 'none' } });
    inp.onchange = () => { this.body.focus({ preventScroll: true }); try { this.restoreSel(sel); } catch (e) {} [...inp.files].forEach(f => this.insertFile(f, kind === 'image' && f.type.startsWith('image/') ? 'image' : 'file')); inp.remove(); };
    document.body.append(inp); inp.click();
  }
  async insertFile(file, kind) {
    try {
      if (kind === 'image') {
        const b = await makeImageBlob(file).catch(() => null);
        if (!b) return this.insertFile(file, 'file');
        this.record();
        this.insertBlock(`<p><img data-blob="${b.id}" src="${b.dataUrl}" alt=""></p>`);
      } else {
        if (file.size > 8 * 1048576) return UI.toast('Filen er større end 8 MB. Store filer understøttes endnu ikke.');
        const dataUrl = await readFileAsDataURL(file);
        const b = { id: uid('b'), name: file.name, type: file.type, size: file.size, dataUrl, createdAt: now() };
        await Store.putBlob(b);
        this.record();
        this.insertBlock(`<div class="att" contenteditable="false" data-blob="${b.id}" data-name="${esc(file.name)}" data-size="${file.size}" data-type="${esc(file.type)}"><span class="ai-ico">${esc(fileExt(file.name))}</span><span><b>${esc(file.name)}</b><small>${fmtSize(file.size)}</small></span></div>`);
      }
      haptic.ok(); this.changed();
    } catch (e) { console.error(e); UI.toast('Filen kunne ikke indsættes'); }
  }
  insertBlock(html) {
    const t = document.createElement('template'); t.innerHTML = html; const node = t.content.firstElementChild;
    const blk = this.block(); const top = blk ? this.topBlock(blk) : null;
    if (top && top.tagName === 'P' && !top.textContent.trim() && !top.querySelector('img')) top.replaceWith(node);
    else if (top) top.after(node); else this.body.append(node);
    let next = node.nextElementSibling; if (!next || next.tagName !== 'P') { next = h('p', h('br')); node.after(next); }
    this.focusEnd(next);
  }
  imageSheet(img) {
    Sheet.open({ title: 'Billede', full: true, build: (body, sheet) => {
      body.append(h('img', { src: img.src, alt: '', style: { width: '100%', borderRadius: '14px', display: 'block' } }));
      const list = h('div.menu-list', { style: { marginTop: '14px' } });
      list.append(h('button.mi', { html: icon('download') + '<span>Gem billede</span>', onclick: async () => { const b = await Store.getBlob(img.dataset.blob); if (b) saveFile((b.name && /\.(png|jpe?g|webp|gif)$/i.test(b.name)) ? b.name : 'billede.jpg', dataUrlToBlob(b.dataUrl)); } }));
      list.append(h('button.mi.danger', { html: icon('trash') + '<span>Fjern billede</span>', onclick: () => { this.record(); const p = img.parentNode; img.remove(); if (p && p.tagName === 'P' && !p.textContent.trim() && !p.querySelector('img')) p.innerHTML = '<br>'; this.changed(); sheet.close(); } }));
      body.append(list);
    } });
  }
  attachmentSheet(att) {
    const name = att.dataset.name, size = +att.dataset.size || 0;
    Sheet.open({ title: name, build: async (body, sheet) => {
      body.append(h('p', { style: { color: 'var(--ink-3)', margin: '-6px 0 14px', fontSize: '14px' }, text: `${fmtSize(size)} · ${att.dataset.type || 'fil'}` }));
      const b = await Store.getBlob(att.dataset.blob);
      if (b && /^image\//.test(b.type)) body.append(h('img', { src: b.dataUrl, alt: '', style: { width: '100%', borderRadius: '12px', marginBottom: '12px' } }));
      if (b && /^text\/|json|csv|markdown/.test(b.type) && b.size < 200000) { try { const txt = await dataUrlToBlob(b.dataUrl).text(); body.append(h('pre', { style: { background: 'var(--fill)', borderRadius: '12px', padding: '12px', whiteSpace: 'pre-wrap', fontSize: '13px', maxHeight: '40vh', overflow: 'auto' }, text: txt.slice(0, 20000) })); } catch (e) {} }
      const list = h('div.menu-list');
      if (b) list.append(h('button.mi', { html: icon('download') + '<span>Download</span>', onclick: () => saveFile(name, dataUrlToBlob(b.dataUrl)) }));
      else list.append(h('div.mi', { html: icon('cloud') + '<span>Filen er ikke hentet til denne enhed endnu</span>' }));
      list.append(h('button.mi.danger', { html: icon('trash') + '<span>Fjern fra note</span>', onclick: () => { this.record(); att.remove(); this.normalize(); this.changed(); sheet.close(); } }));
      body.append(list);
    } });
  }

  /* ---------- find highlight from search ---------- */
  findText(q) {
    const { terms } = Search.parse(q); if (!terms.length) return;
    const tw = document.createTreeWalker(this.body, NodeFilter.SHOW_TEXT);
    let node; while ((node = tw.nextNode())) {
      const i = norm(node.textContent).indexOf(terms[0]);
      if (i >= 0) {
        const r = document.createRange(); r.setStart(node, i); r.setEnd(node, Math.min(node.length, i + terms[0].length));
        const rect = r.getBoundingClientRect(); this.scroll.scrollBy({ top: rect.top - 160, behavior: 'smooth' });
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); return;
      }
    }
  }

  /* ---------- note menu ---------- */
  async colorPick() {
    const c = await pickColor(this.note.color || 'yellow');
    if (c) { Store.update(this.id, { color: c }, { touch: false, quiet: true }); this.renderMeta(); }
  }
  moreMenu() {
    this.flush();
    const n = this.note; const d = Store.d(n);
    UI.menu(noteTitle(n), [
      { icon: 'pin', label: n.pinned ? 'Frigør' : 'Fastgør', onClick: () => { Store.update(this.id, { pinned: !n.pinned }, { touch: false, quiet: true }); this.renderMeta(); } },
      { icon: 'star', label: n.favorite ? 'Fjern fra favoritter' : 'Føj til favoritter', onClick: () => { Store.update(this.id, { favorite: !n.favorite }, { touch: false, quiet: true }); UI.toast(n.favorite ? 'Tilføjet til favoritter' : 'Fjernet fra favoritter'); } },
      { icon: 'palette', label: 'Farve', onClick: () => this.colorPick() },
      { icon: 'move', label: 'Flyt til mappe', right: esc(Store.entity('folders', n.folderId)?.name || 'Ingen'), onClick: async () => { const f = await pickFolder(n.folderId); if (f !== undefined) { Store.update(this.id, { folderId: f }, { touch: false, quiet: true }); this.renderMeta(); } } },
      { icon: 'tag', label: 'Tags', onClick: () => editTagsAndRefresh(this) },
      '-',
      { icon: 'history', label: 'Versionshistorik', onClick: () => this.historySheet() },
      { icon: 'copy', label: 'Kopiér som Markdown', onClick: () => navigator.clipboard.writeText((n.title ? `# ${n.title}\n\n` : '') + MD.fromHtml(n.html)).then(() => UI.toast('Kopieret som Markdown'), () => UI.toast('Kunne ikke kopiere')) },
      { icon: 'download', label: 'Eksportér som Markdown', onClick: () => saveFile(safeName(noteTitle(n)) + '.md', (n.title ? `# ${n.title}\n\n` : '') + MD.fromHtml(n.html)) },
      { icon: 'template', label: 'Gem som skabelon', onClick: () => { Store.upsert('templates', { id: uid('t'), name: noteTitle(n), html: n.html }); UI.toast('Gemt som skabelon'); } },
      { icon: 'info', label: 'Info', right: `${d.words} ord`, onClick: () => this.infoSheet() },
      '-',
      { icon: 'archive', label: n.archived ? 'Fjern fra arkiv' : 'Arkivér', onClick: () => { Store.update(this.id, { archived: !n.archived, pinned: false }, { touch: false }); Nav.pop(); UI.toast(n.archived ? 'Arkiveret' : 'Fjernet fra arkiv'); } },
      { icon: 'trash', label: 'Flyt til papirkurv', danger: true, onClick: () => { const note = this.note; Nav.pop(); setTimeout(() => trashNote(note), 50); } },
    ]);
  }
  infoSheet() {
    const n = this.note, d = Store.d(n);
    const row = (k, v) => h('div.mi', { html: `<span>${k}</span><span class="r">${v}</span>` });
    Sheet.open({ title: 'Info', build: body => body.append(h('div.menu-list',
      row('Ord', d.words.toLocaleString('da-DK')), row('Læsetid', `${d.readMin} min.`), row('Tegn', d.text.length.toLocaleString('da-DK')),
      row('Opgaver', `${d.tasks.filter(t => t.done).length} af ${d.tasks.length} fuldført`), row('Links ud', d.links.length), row('Henvisninger hertil', Search.backlinks(n.id).length),
      row('Oprettet', new Date(n.createdAt).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' })), row('Ændret', new Date(n.updatedAt).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' })),
      row('Synkronisering', n.syncError === 'too-large' ? 'For stor til skyen' : n.dirty ? 'Venter' : 'Synkroniseret'))) });
  }
  async historySheet() {
    const vs = await Store.versions(this.id);
    Sheet.open({ title: 'Versionshistorik', full: true, build: (body, sheet) => {
      if (!vs.length) { body.append(UI.empty('history', 'Ingen tidligere versioner', 'Versioner gemmes automatisk mens du skriver, højst hvert 5. minut, på denne enhed.')); return; }
      body.append(h('p', { style: { color: 'var(--ink-2)', fontSize: '14px', margin: '0 0 12px' }, text: 'Versioner gemmes på denne enhed. Ændringer fra andre enheder, der kolliderede med dine, ligger her også.' }));
      const list = h('div.menu-list');
      vs.forEach(v => list.append(h('button.mi', { html: icon(v.reason === 'conflict' ? 'sync' : 'history') + `<span>${esc(new Date(v.at).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' }))}<small style="display:block;color:var(--ink-3);font-size:13px">${v.reason === 'conflict' ? 'Fra anden enhed · ' : ''}${wordCount(htmlToText(v.html))} ord · ${esc((v.title || htmlToText(v.html)).slice(0, 40))}</small></span>`, onclick: () => preview(v) })));
      body.append(list);
      const preview = (v) => Sheet.open({ title: new Date(v.at).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' }), full: true, build: (b2, sh2) => {
        const box = h('div.ai-out', { style: { maxHeight: '60vh' } }); box.innerHTML = (v.title ? `<h2>${esc(v.title)}</h2>` : '') + sanitizeHtml(v.html);
        b2.append(box, h('div.sheet-actions', h('button.btn', { text: 'Gendan denne version', onclick: () => {
          Store.snapshot({ ...this.note }, 'before-restore'); this.record();
          this.title.value = v.title || ''; this.body.innerHTML = v.html; this.normalize(); this.hydrate(); this.autoTitle(); this.changed(); this.flush();
          sh2.close(); sheet.close(); UI.toast('Version gendannet');
        } })));
      } });
    } });
  }
}
function editTagsAndRefresh(ed) {
  ed.flush(); editTags(ed.note);
  const off = Bus.on('notes', e => { if (e.id === ed.id) ed.renderMeta(); });
  setTimeout(() => { const chk = setInterval(() => { if (!Sheet.stack.length) { off(); clearInterval(chk); ed.renderMeta(); } }, 300); }, 400);
}

/* Compress an image to at most 1600px / ~0.82 JPEG (PNG kept when small or transparent-looking). */
async function makeImageBlob(file) {
  const src = await readFileAsDataURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const max = 1600; let { width: w, height: hh } = img;
  let dataUrl = src;
  if (w > max || hh > max || src.length > 400000) {
    const s = Math.min(1, max / Math.max(w, hh)); w = Math.round(w * s); hh = Math.round(hh * s);
    const c = document.createElement('canvas'); c.width = w; c.height = hh; c.getContext('2d').drawImage(img, 0, 0, w, hh);
    dataUrl = c.toDataURL('image/jpeg', .82);
  }
  const b = { id: uid('b'), name: file.name || 'billede.jpg', type: dataUrl.slice(5, dataUrl.indexOf(';')), size: Math.round(dataUrl.length * .75), dataUrl, createdAt: now() };
  await Store.putBlob(b);
  return b;
}
function safeName(s) { return String(s || 'note').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'note'; }

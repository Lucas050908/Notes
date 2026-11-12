/* ===== 05-ui: navigation stack, tab bar, sheets, dialogs, toasts, shared components ===== */

const Screens = {};
const Nav = {
  app: null, tabs: {}, current: 'home', stack: [],

  init() {
    this.app = $('#app');
    this.tabbar = h('nav.tabbar', { role: 'tablist' },
      [['home', 'Hjem', 'home'], ['notes', 'Noter', 'notes'], ['tasks', 'Opgaver', 'tasks'], ['assistant', 'Assistent', 'spark']].map(([k, label, ic]) =>
        h('button', { 'data-tab': k, role: 'tab', 'aria-label': label, html: icon(ic) + `<span>${label}</span>`, onclick: () => { haptic.tap(); this.tab(k); } })));
    this.fab = h('button.fab', { 'aria-label': 'Ny note', title: 'Ny note (⌘N)', html: icon('plus'), onclick: () => { haptic.tap(); newNote(); } });
    document.body.append(this.tabbar, this.fab);
    this.edgeSwipe();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (Sheet.stack.length) Sheet.stack[Sheet.stack.length - 1].close(); else if (Pop.cur) Pop.close(); else if (this.stack.length) this.pop(); }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
      if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); newNote(); }
    });
  },
  tab(name) {
    if (this.stack.length) { while (this.stack.length > 1) this.popInstant(); this.pop(); }
    for (const k in this.tabs) this.tabs[k].el.classList.toggle('hidden', k !== name);
    const s = this.tabs[name];
    if (this.current === name && s.el.querySelector('.scroll')) s.el.querySelector('.scroll').scrollTo({ top: 0, behavior: 'smooth' });
    this.current = name;
    $$('button', this.tabbar).forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    s.render && s.render();
    this.chrome();
  },
  register(name, screen) { this.tabs[name] = screen; screen.el.classList.add('hidden'); this.app.append(screen.el); },
  push(screen) {
    const prev = this.top();
    screen.el.classList.add('enter');
    this.app.append(screen.el);
    this.stack.push(screen);
    requestAnimationFrame(() => requestAnimationFrame(() => { screen.el.classList.remove('enter'); prev && prev.el.classList.add('under'); }));
    this.chrome();
    screen.onShow && screen.onShow();
  },
  pop() {
    const s = this.stack.pop(); if (!s) return;
    s.onHide && s.onHide();
    s.el.classList.add('leave');
    const prev = this.top(); prev && prev.el.classList.remove('under');
    setTimeout(() => { s.el.remove(); s.destroy && s.destroy(); }, 380);
    this.chrome();
    prev && prev.render && prev.render();
  },
  popInstant() { const s = this.stack.pop(); if (!s) return; s.onHide && s.onHide(); s.el.remove(); s.destroy && s.destroy(); },
  top() { return this.stack[this.stack.length - 1] || this.tabs[this.current]; },
  chrome() {
    const t = this.top();
    const hideTab = this.stack.length > 0;
    this.tabbar.classList.toggle('away', hideTab);
    this.fab.classList.toggle('away', !!(hideTab || this.current === 'assistant' || (t && t.noFab)));
    $$('.composer').forEach(c => c.classList.toggle('hidden', hideTab || this.current !== 'assistant' || !AI.available));
  },
  refresh() { const t = this.top(); t && t.render && t.render(); for (const s of this.stack) if (s !== t && s.stale !== undefined) s.stale = true; },
  edgeSwipe() {
    let sx = 0, sy = 0, s = null, prev = null, active = false, dx = 0;
    this.app.addEventListener('touchstart', e => {
      if (!this.stack.length || Sheet.stack.length) return;
      const t = e.touches[0]; if (t.clientX > 24) return;
      sx = t.clientX; sy = t.clientY; s = this.top(); prev = this.stack[this.stack.length - 2] || this.tabs[this.current]; active = null; dx = 0;
    }, { passive: true });
    this.app.addEventListener('touchmove', e => {
      if (!s) return; const t = e.touches[0]; dx = t.clientX - sx; const dy = t.clientY - sy;
      if (active === null) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) active = dx > Math.abs(dy); if (!active) { s = null; return; } }
      if (!active) return;
      s.el.style.transition = 'none'; prev.el.style.transition = 'none';
      const w = window.innerWidth; const x = Math.max(0, dx);
      s.el.style.transform = `translateX(${x}px)`; prev.el.style.transform = `translateX(${-0.24 * w + 0.24 * x}px)`; prev.el.style.opacity = .6 + .4 * x / w;
    }, { passive: true });
    this.app.addEventListener('touchend', () => {
      if (!s || !active) { s = null; return; }
      const done = dx > window.innerWidth * .33;
      s.el.style.transition = ''; prev.el.style.transition = ''; prev.el.style.opacity = ''; prev.el.style.transform = ''; s.el.style.transform = '';
      if (done) { haptic.tap(); this.pop(); }
      s = null;
    });
  },
};

/* ---------- Generic screen with a top bar ---------- */
function makeScreen({ title = '', back = 'Tilbage', paper = false, actions = [], large = true } = {}) {
  const el = h('section.screen' + (paper ? '.paper' : ''));
  const bar = h('header.topbar',
    h('button.backbtn', { 'aria-label': 'Tilbage', html: icon('back') + `<span>${esc(back)}</span>`, onclick: () => Nav.pop() }),
    h('div.title', { text: large ? '' : title }),
    ...actions);
  const scroll = h('div.scroll');
  const wrap = h('div.wrap', { style: { paddingBottom: '120px' } });
  if (large && title) wrap.append(h('h1.bigtitle', { text: title }));
  scroll.append(wrap);
  scroll.addEventListener('scroll', () => {
    bar.classList.toggle('scrolled', scroll.scrollTop > 4);
    if (large) bar.querySelector('.title').textContent = scroll.scrollTop > 40 ? title : '';
  }, { passive: true });
  el.append(bar, scroll);
  return { el, bar, scroll, wrap, setTitle(t) { title = t; const b = wrap.querySelector('.bigtitle'); if (b) b.textContent = t; } };
}

/* ---------- Sheets ---------- */
const Sheet = {
  stack: [],
  open({ title = '', build, full = false, onClose, headRight } = {}) {
    const scrim = h('div.scrim');
    const body = h('div.sh-body');
    const head = h('div.sh-head', h('h3', { text: title }), headRight || null,
      h('button.iconbtn', { 'aria-label': 'Luk', html: icon('close', 'sm'), onclick: () => api.close() }));
    const el = h('div.sheet' + (full ? '.full' : ''), { role: 'dialog', 'aria-label': title }, h('div.grab'), head, body);
    document.body.append(scrim, el);
    let closed = false;
    const api = {
      el, body, head,
      close(val) {
        if (closed) return; closed = true;
        el.classList.remove('on'); scrim.classList.remove('on');
        Sheet.stack.splice(Sheet.stack.indexOf(api), 1);
        setTimeout(() => { el.remove(); scrim.remove(); }, 420);
        onClose && onClose(val);
      },
      setTitle(t) { head.querySelector('h3').textContent = t; },
    };
    scrim.addEventListener('click', () => api.close());
    // drag to dismiss
    let sy = null, dy = 0;
    const start = e => { if (body.scrollTop > 0 && !e.target.closest('.sh-head,.grab')) return; sy = e.touches[0].clientY; dy = 0; };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', e => {
      if (sy == null) return; dy = e.touches[0].clientY - sy;
      if (dy > 0 && (body.scrollTop <= 0 || e.target.closest('.sh-head,.grab'))) { el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`; } else { dy = 0; }
    }, { passive: true });
    el.addEventListener('touchend', () => {
      if (sy == null) return; sy = null; el.style.transition = ''; el.style.transform = '';
      if (dy > 110) api.close();
    });
    this.stack.push(api);
    build && build(body, api);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('on'); scrim.classList.add('on'); }));
    return api;
  },
};

const UI = {
  toast(text, { action, onAction, duration = 3200 } = {}) {
    $$('.toast').forEach(t => t.remove());
    const t = h('div.toast', { role: 'status' }, h('span', { text }));
    if (Nav.stack.length) t.classList.add('editor');
    if (action) t.append(h('button', { text: action, onclick: () => { onAction && onAction(); t.classList.remove('on'); } }));
    document.body.append(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, duration);
  },
  dialog({ title, text, build, buttons }) {
    return new Promise(res => {
      const scrim = h('div.scrim'); const box = h('div.box', h('h3', { text: title }), text ? h('p', { text }) : null);
      const wrap = h('div.dialog', { role: 'alertdialog' }, box);
      const done = v => { wrap.classList.remove('on'); scrim.classList.remove('on'); setTimeout(() => { wrap.remove(); scrim.remove(); }, 250); res(v); };
      const ctx = build ? build(box) : null;
      box.append(h('div.sheet-actions', buttons.map(b => h('button.btn' + (b.cls ? '.' + b.cls : ''), { text: b.label, onclick: () => done(b.value === '__input' ? ctx.value : b.value) }))));
      wrap.addEventListener('click', e => { if (e.target === wrap) done(null); });
      document.body.append(scrim, wrap);
      requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add('on'); scrim.classList.add('on'); ctx && ctx.focus && ctx.focus(); }));
      if (ctx) ctx.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(ctx.value); } });
    });
  },
  confirm({ title, text, ok = 'OK', danger = false }) {
    return this.dialog({ title, text, buttons: [{ label: 'Annullér', value: false, cls: 'ghost' }, { label: ok, value: true, cls: danger ? 'danger' : '' }] });
  },
  prompt({ title, text, value = '', placeholder = '', ok = 'Gem' }) {
    return this.dialog({
      title, text,
      build: box => { const i = h('input.input#dlg-input', { value, placeholder, autocomplete: 'off' }); box.append(i); setTimeout(() => i.select(), 80); return i; },
      buttons: [{ label: 'Annullér', value: null, cls: 'ghost' }, { label: ok, value: '__input' }],
    }).then(v => (v == null ? null : String(v).trim()));
  },
  menu(title, items) {
    return Sheet.open({
      title, build(body, sheet) {
        let group = h('div.menu-list'); body.append(group);
        for (const it of items) {
          if (it === '-') { group = h('div.menu-list'); body.append(group); continue; }
          if (!it) continue;
          const b = h('button.mi' + (it.danger ? '.danger' : ''), { html: (it.icon ? icon(it.icon) : '') + `<span>${esc(it.label)}</span>` + (it.right ? `<span class="r">${it.right}</span>` : '') });
          if (it.toggle !== undefined) b.append(h('span.sw' + (it.toggle ? '.on' : '')));
          b.onclick = () => { haptic.tap(); if (it.keepOpen) { it.onClick && it.onClick(b); } else { sheet.close(); setTimeout(() => it.onClick && it.onClick(), 120); } };
          group.append(b);
        }
      },
    });
  },
  empty(ic, title, text, btn) {
    return h('div.empty', h('div.ei', { html: icon(ic) }), h('h3', { text: title }), h('p', { text }), btn ? h('button.btn', { text: btn.label, onclick: btn.onClick }) : null);
  },
};

/* ---------- Popover anchored to a rect (slash menu, link picker) ---------- */
const Pop = {
  cur: null,
  open(rect, buildFn) {
    this.close();
    const el = h('div.pop', { role: 'listbox' });
    document.body.append(el);
    buildFn(el);
    const vv = window.visualViewport; const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
    const w = Math.min(280, window.innerWidth - 24);
    el.style.width = w + 'px';
    el.style.left = clamp(rect.left, 12, window.innerWidth - w - 12) + 'px';
    const below = rect.bottom + 6, hgt = Math.min(300, el.scrollHeight);
    el.style.top = (below + hgt > vh - 60 ? Math.max(12, rect.top - hgt - 6) : below) + 'px';
    this.cur = el;
    return el;
  },
  close() { if (this.cur) { this.cur.remove(); this.cur = null; } },
};
document.addEventListener('pointerdown', e => { if (Pop.cur && !Pop.cur.contains(e.target) && !e.target.closest('.ed-body')) Pop.close(); });

/* ---------- Note row with swipe actions and long-press ---------- */
function noteRow(n, { q = '', showFolder = true, onOpen } = {}) {
  const d = Store.d(n);
  const row = h('div.row', { 'data-id': n.id });
  const sw = h('div.swipe-actions', h('div.l', { html: icon(n.pinned ? 'pin' : 'pin', 'sm') + (n.pinned ? 'Frigør' : 'Fastgør') }), h('div.r', { html: (n.trashedAt ? 'Slet' : 'Papirkurv') + icon('trash', 'sm') }));
  const folder = showFolder && n.folderId ? Store.entity('folders', n.folderId) : null;
  const open = d.tasks.filter(t => !t.done).length;
  const meta = [
    `<span>${fmtRel(n.updatedAt)}</span>`,
    folder ? `<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:7px;height:7px;border-radius:50%;background:${folder.color || 'var(--ink-3)'};display:inline-block"></i>${esc(folder.name)}</span>` : '',
    d.tasks.length ? `<span>${icon('tasks', 'xs')} ${d.tasks.length - open}/${d.tasks.length}</span>` : '',
    (n.tags || []).slice(0, 3).map(t => `<span class="tag">#${esc(t)}</span>`).join(''),
  ].join('');
  const title = q ? Search.highlight(noteTitle(n), q) : esc(noteTitle(n));
  const snip = q ? Search.snippet(n, q) : esc(d.snippet.slice(noteTitle(n) === d.snippet.slice(0, noteTitle(n).length) && !n.title ? noteTitle(n).length : 0).trim().slice(0, 160));
  const inner = h('button.row-inner' + (q ? '.hit' : ''), {
    'aria-label': noteTitle(n),
    html: `<div class="row-main"><div class="row-title"><i class="stdot st-${n.color || 'yellow'}"></i>${n.pinned ? `<span class="mini-ico acc">${icon('pin', 'xs')}</span>` : ''}${n.favorite ? `<span class="mini-ico star">${icon('star', 'xs')}</span>` : ''}<span class="t">${title}</span></div>${snip ? `<div class="row-snip">${snip}</div>` : ''}<div class="row-meta">${meta}</div></div>`,
  });
  if (d.img) {
    const im = h('img.row-thumb', { alt: '' }); inner.append(im);
    Store.getBlob(d.img).then(b => { if (b) im.src = b.dataUrl; else im.remove(); });
  }
  row.append(sw, inner);
  let lp = null, moved = false;
  inner.addEventListener('click', () => { if (moved) return; haptic.tap(); onOpen ? onOpen(n) : openNote(n.id); });
  inner.addEventListener('contextmenu', e => { e.preventDefault(); noteActions(n); });
  // swipe
  let sx = 0, sy = 0, dx = 0, dir = null;
  inner.addEventListener('touchstart', e => {
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; dx = 0; dir = null; moved = false;
    lp = setTimeout(() => { if (!dir) { moved = true; haptic.ok(); noteActions(n); } }, 520);
  }, { passive: true });
  inner.addEventListener('touchmove', e => {
    const t = e.touches[0]; const ddx = t.clientX - sx, ddy = t.clientY - sy;
    if (!dir && (Math.abs(ddx) > 10 || Math.abs(ddy) > 10)) { dir = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v'; clearTimeout(lp); }
    if (dir === 'h') { moved = true; dx = clamp(ddx, -140, 140); inner.style.transition = 'none'; inner.style.transform = `translateX(${dx}px)`; }
  }, { passive: true });
  inner.addEventListener('touchend', () => {
    clearTimeout(lp);
    inner.style.transition = ''; inner.style.transform = '';
    if (dir === 'h') {
      if (dx > 90) { haptic.ok(); Store.update(n.id, { pinned: !n.pinned }, { touch: false }); UI.toast(n.pinned ? 'Fastgjort' : 'Frigjort'); }
      else if (dx < -90) { haptic.warn(); if (n.trashedAt) deleteForever(n); else trashNote(n); }
    }
    setTimeout(() => { moved = false; }, 50);
  });
  return row;
}

/* ---------- Sticky note card ---------- */
function stickyCard(n, { onOpen } = {}) {
  const d = Store.d(n); const t = noteTitle(n);
  let body = d.text.replace(/\s+/g, ' ').trim(); if (!n.title && body.startsWith(t)) body = body.slice(t.length).trim();
  const done = d.tasks.filter(x => x.done).length;
  const el = h('button.sticky.st-' + (n.color || 'yellow') + (n.pinned ? '.pinned' : ''), { 'aria-label': t, 'data-id': n.id });
  if (d.img) { const im = h('img.thumb', { alt: '' }); el.append(im); Store.getBlob(d.img).then(b => { if (b) im.src = b.dataUrl; else im.remove(); }); }
  el.append(h('h3', { text: t }), body ? h('p', { text: body.slice(0, 240) }) : h('p'),
    h('div.meta', { html: [n.favorite ? `<span class="mini-ico star">${icon('star', 'xs')}</span>` : '', `<span>${fmtRel(n.updatedAt)}</span>`, d.tasks.length ? `<span class="tick">${icon('tasks', 'xs')}${done}/${d.tasks.length}</span>` : '', (n.tags || []).slice(0, 2).map(x => `<span class="tag">#${esc(x)}</span>`).join('')].join('') }));
  let lp = null, long = false;
  el.addEventListener('click', () => { if (long) { long = false; return; } haptic.tap(); onOpen ? onOpen(n) : openNote(n.id); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); noteActions(n); });
  el.addEventListener('touchstart', () => { long = false; lp = setTimeout(() => { long = true; haptic.ok(); noteActions(n); }, 520); }, { passive: true });
  ['touchmove', 'touchend', 'touchcancel'].forEach(ev => el.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
  return el;
}
function pickColor(cur) {
  return new Promise(res => {
    let out;
    Sheet.open({ title: 'Farve', onClose: () => res(out), build(body, sheet) {
      const g = h('div.color-dots');
      NOTE_COLORS.forEach(([k, l]) => g.append(h('button.st-' + k + (k === cur ? '.on' : ''), { 'aria-label': l, title: l, html: k === cur ? icon('check', 'sm') : '', onclick: () => { out = k; haptic.tap(); sheet.close(); } })));
      body.append(g);
    } });
  });
}

function trashNote(n) {
  Store.trash(n.id);
  UI.toast('Flyttet til papirkurven', { action: 'Fortryd', onAction: () => Store.restore(n.id) });
}
async function deleteForever(n) {
  if (await UI.confirm({ title: 'Slet permanent?', text: `"${noteTitle(n)}" slettes på alle dine enheder. Det kan ikke fortrydes.`, ok: 'Slet', danger: true })) Store.destroy(n.id);
}

function noteActions(n) {
  if (n.trashedAt) return UI.menu(noteTitle(n), [
    { icon: 'restore', label: 'Gendan', onClick: () => { Store.restore(n.id); UI.toast('Note gendannet'); } },
    { icon: 'trash', label: 'Slet permanent', danger: true, onClick: () => deleteForever(n) },
  ]);
  UI.menu(noteTitle(n), [
    { icon: 'pin', label: n.pinned ? 'Frigør' : 'Fastgør', onClick: () => Store.update(n.id, { pinned: !n.pinned }, { touch: false }) },
    { icon: 'star', label: n.favorite ? 'Fjern fra favoritter' : 'Føj til favoritter', onClick: () => Store.update(n.id, { favorite: !n.favorite }, { touch: false }) },
    '-',
    { icon: 'palette', label: 'Farve', right: esc((NOTE_COLORS.find(c => c[0] === (n.color || 'yellow')) || [])[1] || ''), onClick: async () => { const c = await pickColor(n.color || 'yellow'); if (c) Store.update(n.id, { color: c }, { touch: false }); } },
    { icon: 'move', label: 'Flyt til mappe', right: esc(Store.entity('folders', n.folderId)?.name || 'Ingen'), onClick: async () => { const f = await pickFolder(n.folderId); if (f !== undefined) { Store.update(n.id, { folderId: f }, { touch: false }); UI.toast(f ? `Flyttet til ${Store.entity('folders', f).name}` : 'Fjernet fra mappe'); } } },
    { icon: 'tag', label: 'Tags', right: (n.tags || []).length || '', onClick: () => editTags(n) },
    { icon: 'copy', label: 'Duplikér', onClick: () => { const c = Store.create({ title: (n.title || noteTitle(n)) + ' (kopi)', html: n.html, folderId: n.folderId, tags: [...(n.tags || [])] }); UI.toast('Duplikeret', { action: 'Åbn', onAction: () => openNote(c.id) }); } },
    { icon: 'template', label: 'Gem som skabelon', onClick: () => { Store.upsert('templates', { id: uid('t'), name: noteTitle(n), html: n.html }); UI.toast('Gemt som skabelon'); } },
    '-',
    { icon: 'archive', label: n.archived ? 'Fjern fra arkiv' : 'Arkivér', onClick: () => { Store.update(n.id, { archived: !n.archived, pinned: false }, { touch: false }); UI.toast(n.archived ? 'Arkiveret' : 'Fjernet fra arkiv', { action: 'Fortryd', onAction: () => Store.update(n.id, { archived: !n.archived }, { touch: false }) }); } },
    { icon: 'trash', label: 'Flyt til papirkurv', danger: true, onClick: () => trashNote(n) },
  ]);
}

function pickFolder(current) {
  return new Promise(res => {
    let result;
    Sheet.open({
      title: 'Vælg mappe', onClose: () => res(result),
      build(body, sheet) {
        const render = () => {
          body.innerHTML = '';
          const list = h('div.menu-list');
          const pick = (id) => { result = id; haptic.tap(); sheet.close(); };
          list.append(h('button.mi', { html: icon('notes') + '<span>Ingen mappe</span>' + (current ? '' : `<span class="r">${icon('check', 'sm')}</span>`), onclick: () => pick(null) }));
          const walk = (parent, depth) => {
            for (const f of Store.entities('folders').filter(f => (f.parentId || null) === parent)) {
              list.append(h('button.mi', { style: { paddingLeft: 14 + depth * 22 + 'px' }, html: `<span style="color:${f.color}">${icon('folder')}</span><span>${esc(f.name)}</span>` + (current === f.id ? `<span class="r">${icon('check', 'sm')}</span>` : ''), onclick: () => pick(f.id) }));
              walk(f.id, depth + 1);
            }
          };
          walk(null, 0);
          body.append(list, h('div.menu-list', h('button.mi', { html: icon('plus') + '<span>Ny mappe</span>', onclick: async () => { const f = await createFolder(); if (f) render(); } })));
        };
        render();
      },
    });
  });
}
async function createFolder(parentId = null) {
  const name = await UI.prompt({ title: parentId ? 'Ny undermappe' : 'Ny mappe', placeholder: 'Navn', ok: 'Opret' });
  if (!name) return null;
  const n = Store.entities('folders').length;
  const f = Store.upsert('folders', { id: uid('f'), name, parentId, color: FOLDER_COLORS[n % FOLDER_COLORS.length], order: n });
  haptic.ok();
  return f;
}

function editTags(n) {
  Sheet.open({
    title: 'Tags', build(body) {
      const render = () => {
        const note = Store.get(n.id); body.innerHTML = '';
        const cur = h('div.tagcloud', { style: { marginBottom: '14px' } });
        (note.tags || []).forEach(t => cur.append(h('button.tagchip', { html: `#${esc(t)} ${icon('close', 'xs')}`, 'aria-label': `Fjern ${t}`, onclick: () => { Store.update(n.id, { tags: note.tags.filter(x => x !== t) }); render(); } })));
        if (!(note.tags || []).length) cur.append(h('span', { style: { color: 'var(--ink-3)', fontSize: '14px' }, text: 'Ingen tags endnu' }));
        const input = h('input.input#tag-input', { placeholder: 'Tilføj tag og tryk Enter', autocomplete: 'off', autocapitalize: 'off' });
        const add = (t) => { t = t.replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-'); if (!t) return; const tags = [...new Set([...(Store.get(n.id).tags || []), t])]; Store.update(n.id, { tags }); haptic.tap(); render(); setTimeout(() => $('#tag-input')?.focus(), 30); };
        input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); } });
        const sugg = h('div.tagcloud', { style: { marginTop: '12px' } });
        const existing = Store.allTags().filter(([t]) => !(note.tags || []).includes(t)).slice(0, 14);
        existing.forEach(([t, c]) => sugg.append(h('button.chip', { html: `#${esc(t)} <small style="color:var(--ink-3)">${c}</small>`, onclick: () => add(t) })));
        body.append(cur, input, existing.length ? h('div.fmt-label', { text: 'Brugte tags' }) : null, sugg);
        if (AI.available) {
          const btn = h('button.btn.ghost.block', { style: { marginTop: '16px' }, html: icon('spark', 'sm') + ' Foreslå tags med AI' });
          btn.onclick = async () => {
            btn.disabled = true; btn.innerHTML = 'Tænker…';
            try {
              const tags = await AI.suggestTags(Store.get(n.id));
              sugg.innerHTML = ''; body.querySelector('.fmt-label')?.remove();
              sugg.before(h('div.fmt-label', { text: 'AI-forslag' }));
              tags.forEach(t => sugg.append(h('button.chip', { html: `${icon('spark', 'xs')} #${esc(t)}`, onclick: (e) => { add(t); } })));
              btn.remove();
            } catch (e) { btn.disabled = false; btn.innerHTML = icon('spark', 'sm') + ' Prøv igen'; UI.toast(AI.errorText(e)); }
          };
          body.append(btn);
        }
      };
      render();
    },
  });
}

/* Keep the tab bar & fixed composers above the on-screen keyboard. */
const KB = {
  open: false, offset: 0, maxH: 0,
  init() {
    const vv = window.visualViewport;
    const upd = () => {
      this.maxH = Math.max(this.maxH, window.innerHeight);
      // Overlay keyboards (iOS, claude.ai) shrink the visual viewport; resizing keyboards (Android app) shrink the window itself.
      const offset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      this.offset = offset > 120 ? offset : 0;
      this.open = offset > 120 || this.maxH - window.innerHeight > 150;
      document.documentElement.style.setProperty('--kb', this.offset + 'px');
      document.body.classList.toggle('kb-open', this.open);
      Bus.emit('kb', this.offset);
    };
    if (vv) { vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd); }
    window.addEventListener('resize', upd);
    window.addEventListener('orientationchange', () => { this.maxH = 0; setTimeout(upd, 300); });
    upd();
  },
};

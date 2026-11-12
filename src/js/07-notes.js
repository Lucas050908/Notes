/* ===== 07-notes: library tab, lists, folders, smart collections, search ===== */

Screens.notes = (() => {
  const el = h('section.screen');
  const scroll = h('div.scroll'); const wrap = h('div.wrap.tab-pad'); scroll.append(wrap); el.append(scroll);
  const expanded = new Set();

  function libRow(ic, label, count, onClick, color) {
    return h('div.row.simple', h('button.row-inner', { onclick: () => { haptic.tap(); onClick(); } },
      h('div.row-ico' + (color ? '.c' : ''), { style: color ? { background: color } : null, html: icon(ic, 'sm') }),
      h('div.row-main', h('div.row-title', h('span.t', { text: label }))),
      h('span.row-count', { text: count }), h('span.row-chev', { html: icon('chev', 'sm') })));
  }

  function render() {
    wrap.innerHTML = '';
    const all = Store.active();
    wrap.append(h('div', { style: { paddingTop: 'calc(var(--safe-t) + 18px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h('h1.bigtitle', { style: { margin: '0' }, text: 'Noter' }),
      h('button.iconbtn.accent', { 'aria-label': 'Ny mappe', title: 'Ny mappe', html: icon('folder'), onclick: async () => { if (await createFolder()) render(); } })));
    wrap.append(h('button.searchpill', { html: icon('search', 'sm') + '<span>Søg</span><kbd>⌘K</kbd>', onclick: () => openSearch() }));

    const lib = h('div.list');
    lib.append(libRow('notes', 'Alle noter', all.length, () => openList({ title: 'Alle noter' }), '#2f5bff'));
    const inbox = all.filter(n => !n.folderId).length;
    lib.append(libRow('archive', 'Uden mappe', inbox, () => openList({ title: 'Uden mappe', filterFn: n => !n.folderId }), '#6b717d'));
    lib.append(libRow('star', 'Favoritter', all.filter(n => n.favorite).length, () => openList({ title: 'Favoritter', filters: { flag: 'favorite' } }), '#f08c00'));
    lib.append(libRow('pin', 'Fastgjort', all.filter(n => n.pinned).length, () => openList({ title: 'Fastgjort', filters: { flag: 'pinned' } }), '#2f9e5b'));
    lib.append(libRow('journal', 'Dagbog', all.filter(n => n.kind === 'daily').length, () => openList({ title: 'Dagbog', filterFn: n => n.kind === 'daily', sort: 'daily' }), '#7a46d8'));
    wrap.append(h('div.section', { style: { marginTop: '20px' } }, lib));

    // Folders
    const folders = Store.entities('folders');
    const ftree = h('div.list');
    const walk = (parent, depth) => {
      for (const f of folders.filter(f => (f.parentId || null) === parent)) {
        const kids = folders.some(x => x.parentId === f.id);
        const ids = Store.folderDescendants(f.id);
        const count = all.filter(n => ids.has(n.folderId)).length;
        const row = h('div.row.simple', h('div.row-inner', { style: { paddingLeft: 16 + depth * 20 + 'px', cursor: 'pointer' }, role: 'button', tabindex: 0,
          onclick: e => { if (e.target.closest('.exp')) return; haptic.tap(); openFolder(f.id); },
          oncontextmenu: e => { e.preventDefault(); folderActions(f); } },
          kids ? h('button.exp.iconbtn', { style: { width: '24px', height: '34px', marginLeft: '-6px', transform: expanded.has(f.id) ? 'rotate(90deg)' : '', transition: 'transform .2s' }, 'aria-label': 'Udvid', html: icon('chev', 'xs'), onclick: () => { expanded.has(f.id) ? expanded.delete(f.id) : expanded.add(f.id); render(); } }) : null,
          h('div.row-ico.c', { style: { background: f.color }, html: icon('folder', 'sm') }),
          h('div.row-main', h('div.row-title', h('span.t', { text: f.name }))),
          h('span.row-count', { text: count }),
          h('button.iconbtn', { style: { width: '32px', height: '32px', color: 'var(--ink-3)' }, 'aria-label': 'Mappevalg', html: icon('more', 'sm'), onclick: e => { e.stopPropagation(); folderActions(f); } })));
        ftree.append(row);
        if (kids && expanded.has(f.id)) walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    if (!folders.length) ftree.append(h('div.empty-inline', { text: 'Ingen mapper endnu. Mapper kan ligge i hinanden.' }));
    wrap.append(h('div.section', h('div.sec-head', h('h2', { text: 'Mapper' }), h('button', { text: 'Ny mappe', onclick: async () => { if (await createFolder()) render(); } })), ftree));

    // Smart collections
    const smart = Store.entities('smart');
    const sl = h('div.list');
    smart.forEach(s => sl.append(h('div.row.simple', h('button.row-inner', { onclick: () => openSmart(s), oncontextmenu: e => { e.preventDefault(); smartActions(s); } },
      h('div.row-ico', { html: icon('smart', 'sm') }), h('div.row-main', h('div.row-title', h('span.t', { text: s.name }))),
      h('span.row-count', { text: Search.run(s.q || '', s.filters || {}).length }), h('span.row-chev', { html: icon('chev', 'sm') })))));
    if (!smart.length) sl.append(h('div.empty-inline', { text: 'Smarte samlinger opdaterer sig selv ud fra en søgning, fx alle noter med åbne opgaver.' }));
    wrap.append(h('div.section', h('div.sec-head', h('h2', { text: 'Smarte samlinger' }), h('button', { text: 'Ny', onclick: () => editSmart() })), sl));

    // Tags
    const tags = Store.allTags();
    if (tags.length) {
      const tc = h('div.tagcloud');
      tags.slice(0, 40).forEach(([t, c]) => tc.append(h('button.tagchip', { html: `#${esc(t)} <small>${c}</small>`, onclick: () => openList({ title: '#' + t, filters: { tag: t } }) })));
      wrap.append(h('div.section', h('div.sec-head', h('h2', { text: 'Tags' })), tc));
    }

    const more = h('div.list');
    more.append(libRow('archive', 'Arkiv', Store.list({ archived: true }).length, () => openList({ title: 'Arkiv', filters: { scope: 'archived' } })));
    more.append(libRow('trash', 'Papirkurv', Store.list({ trashed: true }).length, () => openTrash()));
    wrap.append(h('div.section', more));
    if (AI.available && all.some(n => !n.folderId)) {
      wrap.append(h('div.section', h('button.btn.ghost.block', { html: icon('wand', 'sm') + ' Organisér noter uden mappe med AI', onclick: () => AI.organizeFlow() })));
    }
  }
  return { el, render };
})();

function folderActions(f) {
  UI.menu(f.name, [
    { icon: 'plus', label: 'Ny note her', onClick: () => newNote({ folderId: f.id }) },
    { icon: 'folder', label: 'Ny undermappe', onClick: async () => { await createFolder(f.id); Nav.refresh(); } },
    { icon: 'text', label: 'Omdøb', onClick: async () => { const name = await UI.prompt({ title: 'Omdøb mappe', value: f.name }); if (name) { Store.upsert('folders', { id: f.id, name }); Nav.refresh(); } } },
    { icon: 'palette', label: 'Farve', onClick: () => Sheet.open({ title: 'Farve', build(body, sh) {
      const sw = h('div.swatches'); FOLDER_COLORS.forEach(c => sw.append(h('button.swatch' + (c === f.color ? '.on' : ''), { style: { background: c }, 'aria-label': c, onclick: () => { Store.upsert('folders', { id: f.id, color: c }); sh.close(); Nav.refresh(); } })));
      body.append(sw);
    } }) },
    { icon: 'move', label: 'Flyt mappe', onClick: async () => {
      const target = await pickFolder(f.parentId || null);
      if (target === undefined) return;
      if (target && Store.folderDescendants(f.id).has(target)) return UI.toast('En mappe kan ikke ligge i sig selv');
      Store.upsert('folders', { id: f.id, parentId: target }); Nav.refresh();
    } },
    '-',
    { icon: 'trash', label: 'Slet mappe', danger: true, onClick: async () => {
      const ids = Store.folderDescendants(f.id);
      const notes = Store.active().filter(n => ids.has(n.folderId));
      if (!await UI.confirm({ title: `Slet "${f.name}"?`, text: notes.length ? `${notes.length} noter flyttes ud af mappen. Noterne slettes ikke.` : 'Mappen er tom.', ok: 'Slet mappe', danger: true })) return;
      for (const n of notes) Store.update(n.id, { folderId: f.parentId || null }, { touch: false });
      for (const id of ids) Store.remove('folders', id);
      if (Nav.stack.length && Nav.top().folderId && ids.has(Nav.top().folderId)) Nav.pop();
      Nav.refresh();
    } },
  ]);
}

/* ---------- Generic list screen ---------- */
function openList({ title, filters = {}, q = '', filterFn, sort, folderId, smart } = {}) {
  const s = makeScreen({ title, back: Nav.stack.length ? 'Tilbage' : ({ home: 'Hjem', notes: 'Noter', tasks: 'Opgaver', assistant: 'Assistent' })[Nav.current] });
  s.folderId = folderId;
  let order = sort || 'edited';
  let view = localStorageGet('margin.view') || 'grid';
  const sortBtn = h('button.iconbtn', { 'aria-label': 'Sortér og valg', html: icon('more') });
  s.bar.append(sortBtn);
  sortBtn.onclick = () => UI.menu('Liste', [
    { icon: view === 'grid' ? 'list' : 'template', label: view === 'grid' ? 'Vis som liste' : 'Vis som sticky notes', onClick: () => { view = view === 'grid' ? 'list' : 'grid'; localStorageSet('margin.view', view); s.render(); } },
    '-',
    { label: 'Senest redigeret', right: order === 'edited' ? icon('check', 'sm') : '', onClick: () => { order = 'edited'; s.render(); } },
    { label: 'Senest oprettet', right: order === 'created' ? icon('check', 'sm') : '', onClick: () => { order = 'created'; s.render(); } },
    { label: 'Titel A–Å', right: order === 'title' ? icon('check', 'sm') : '', onClick: () => { order = 'title'; s.render(); } },
    folderId ? '-' : null,
    folderId ? { icon: 'more', label: 'Mappevalg', onClick: () => folderActions(Store.entity('folders', folderId)) } : null,
    smart ? '-' : null,
    smart ? { icon: 'smart', label: 'Redigér samling', onClick: () => editSmart(smart) } : null,
    smart ? { icon: 'trash', label: 'Slet samling', danger: true, onClick: () => { Store.remove('smart', smart.id); Nav.pop(); } } : null,
  ]);
  if (folderId) s.bar.append(h('button.iconbtn.accent', { 'aria-label': 'Ny note i mappen', html: icon('plus'), onclick: () => newNote({ folderId }) }));

  s.render = () => {
    const keepScroll = s.scroll.scrollTop;
    $$(':scope > :not(.bigtitle)', s.wrap).forEach(x => x.remove());
    if (folderId) {
      const f = Store.entity('folders', folderId); if (!f) return;
      s.setTitle(f.name);
      const subs = Store.entities('folders').filter(x => x.parentId === folderId);
      if (subs.length) {
        const g = h('div.list', { style: { marginBottom: '18px' } });
        subs.forEach(sf => {
          const ids = Store.folderDescendants(sf.id); const c = Store.active().filter(n => ids.has(n.folderId)).length;
          g.append(h('div.row.simple', h('button.row-inner', { onclick: () => openFolder(sf.id) },
            h('div.row-ico.c', { style: { background: sf.color }, html: icon('folder', 'sm') }), h('div.row-main', h('div.row-title', h('span.t', { text: sf.name }))),
            h('span.row-count', { text: c }), h('span.row-chev', { html: icon('chev', 'sm') }))));
        });
        s.wrap.append(g);
      }
    }
    let items = Search.run(q, filters).map(r => r.n);
    if (folderId) items = items.filter(n => n.folderId === folderId);
    if (filterFn) items = items.filter(filterFn);
    if (order === 'created') items.sort((a, b) => b.createdAt - a.createdAt);
    else if (order === 'title') items.sort((a, b) => noteTitle(a).localeCompare(noteTitle(b), 'da'));
    else if (order === 'daily') items.sort((a, b) => (b.dailyDate || '').localeCompare(a.dailyDate || '') || b.updatedAt - a.updatedAt);
    else items.sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt);
    s.wrap.append(h('div.listhead', h('span.count', { text: `${items.length} ${items.length === 1 ? 'note' : 'noter'}` })));
    if (!items.length) {
      s.wrap.append(UI.empty(folderId ? 'folder' : 'notes', folderId ? 'Mappen er tom' : 'Ingen noter her', folderId ? 'Skriv en note direkte i mappen, eller flyt eksisterende noter hertil.' : 'Noter, der passer, dukker op her af sig selv.', folderId ? { label: 'Ny note i mappen', onClick: () => newNote({ folderId }) } : null));
      return;
    }
    const groups = order === 'edited' ? groupByDate(items) : [[null, items]];
    let rendered = 0; const LIMIT = 60;
    const target = h('div');
    s.wrap.append(target);
    const draw = (from) => {
      for (const [label, arr] of groups) {
        for (const n of arr) {
          if (rendered++ < from) continue;
          if (rendered > from + LIMIT) return true;
          let list = target.lastElementChild;
          if (label && (!list || list.dataset.g !== label)) { target.append(h('div.datehead', { text: label })); list = null; }
          const cls = view === 'grid' ? 'sticky-grid' : 'list';
          if (!list || !list.classList.contains(cls)) { list = h('div.' + cls, { 'data-g': label || '' }); target.append(list); }
          list.append(view === 'grid' ? stickyCard(n) : noteRow(n, { q, showFolder: !folderId }));
        }
      }
      return false;
    };
    let shown = 0; let more = draw(0); shown = LIMIT;
    if (more) {
      const sentinel = h('div', { style: { height: '40px' } }); s.wrap.append(sentinel);
      const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { rendered = 0; more = draw(shown); shown += LIMIT; if (!more) { io.disconnect(); sentinel.remove(); } } }, { root: s.scroll, rootNotabene: '400px' });
      io.observe(sentinel);
    }
    s.scroll.scrollTop = keepScroll;
  };
  s.render();
  Nav.push(s);
  return s;
}
function groupByDate(items) {
  const g = new Map(); const today = new Date();
  for (const n of items) {
    const diff = dayDiff(today, new Date(n.updatedAt));
    const label = n.pinned ? 'Fastgjort' : diff === 0 ? 'I dag' : diff === 1 ? 'I går' : diff < 7 ? 'Denne uge' : diff < 30 ? 'Denne måned' : `${DA_MON[new Date(n.updatedAt).getMonth()].replace(/^./, c => c.toUpperCase())} ${new Date(n.updatedAt).getFullYear()}`;
    if (!g.has(label)) g.set(label, []); g.get(label).push(n);
  }
  return [...g.entries()];
}
function openFolder(id) { const f = Store.entity('folders', id); if (f) openList({ title: f.name, folderId: id }); }
function openSmart(s) { openList({ title: s.name, q: s.q || '', filters: s.filters || {}, smart: s }); }

function openTrash() {
  const s = makeScreen({ title: 'Papirkurv', back: 'Noter' });
  s.render = () => {
    $$(':scope > :not(.bigtitle)', s.wrap).forEach(x => x.remove());
    const items = Store.list({ trashed: true }).sort((a, b) => b.trashedAt - a.trashedAt);
    s.wrap.append(h('p', { style: { color: 'var(--ink-2)', fontSize: '14px', margin: '-8px 0 16px' }, text: `Noter slettes automatisk efter ${Store.setting('trashDays') || 30} dage. Stryg til venstre for at slette med det samme.` }));
    if (!items.length) { s.wrap.append(UI.empty('trash', 'Papirkurven er tom', 'Slettede noter ligger her, indtil de fjernes for altid.')); return; }
    const list = h('div.list'); items.forEach(n => list.append(noteRow(n, { onOpen: noteActions }))); s.wrap.append(list);
    s.wrap.append(h('button.btn.danger.block', { style: { marginTop: '20px' }, text: 'Tøm papirkurven', onclick: async () => {
      if (await UI.confirm({ title: 'Tøm papirkurven?', text: `${items.length} noter slettes permanent på alle enheder.`, ok: 'Tøm', danger: true })) { for (const n of items) await Store.destroy(n.id); haptic.ok(); }
    } }));
  };
  s.render(); Nav.push(s);
}

/* ---------- Smart collections ---------- */
const SMART_FILTERS = [
  ['has:open', 'Åbne opgaver', { has: 'open' }], ['has:tasks', 'Har opgaver', { has: 'tasks' }], ['has:image', 'Med billeder', { has: 'image' }],
  ['has:att', 'Med filer', { has: 'attachment' }], ['flag:pinned', 'Fastgjort', { flag: 'pinned' }], ['flag:fav', 'Favoritter', { flag: 'favorite' }],
  ['since:7', 'Sidste 7 dage', { sinceDays: 7 }], ['since:30', 'Sidste 30 dage', { sinceDays: 30 }],
];
function filtersFromKeys(keys) {
  const f = {}; for (const k of keys) { const def = SMART_FILTERS.find(x => x[0] === k); if (def) Object.assign(f, def[2]); }
  if (f.sinceDays) { f.since = now() - f.sinceDays * 86400000; }
  return f;
}
function editSmart(existing, preset = {}) {
  const st = { name: existing?.name || preset.name || '', q: existing?.q ?? preset.q ?? '', keys: new Set(existing?.keys || preset.keys || []), folderId: existing?.filters?.folderId || null };
  Sheet.open({ title: existing ? 'Redigér samling' : 'Ny smart samling', build(body, sheet) {
    const name = h('input.input#smart-name', { value: st.name, placeholder: 'Fx "Projekter med åbne opgaver"' });
    const q = h('input.input#smart-q', { value: st.q, placeholder: 'Søgeord eller #tag (valgfrit)', autocapitalize: 'off' });
    const chips = h('div.tagcloud');
    const count = h('div', { style: { fontSize: '14px', color: 'var(--ink-2)', margin: '14px 0 0' } });
    const upd = () => { const f = { ...filtersFromKeys(st.keys), folderId: st.folderId || undefined }; count.textContent = `${Search.run(q.value, f).length} noter passer lige nu`; };
    SMART_FILTERS.forEach(([k, label]) => { const c = h('button.chip' + (st.keys.has(k) ? '.on' : ''), { text: label, onclick: () => { st.keys.has(k) ? st.keys.delete(k) : st.keys.add(k); c.classList.toggle('on'); upd(); } }); chips.append(c); });
    const fbtn = h('button.chip', { html: icon('folder', 'sm') + esc(st.folderId ? Store.entity('folders', st.folderId)?.name : 'Alle mapper'), onclick: async () => { const f = await pickFolder(st.folderId); if (f !== undefined) { st.folderId = f; fbtn.innerHTML = icon('folder', 'sm') + esc(f ? Store.entity('folders', f).name : 'Alle mapper'); upd(); } } });
    chips.append(fbtn);
    q.addEventListener('input', upd); upd();
    body.append(h('div.field', h('label', { for: 'smart-name', text: 'Navn' }), name), h('div.field', h('label', { for: 'smart-q', text: 'Søgning' }), q),
      h('div.fmt-label', { text: 'Betingelser' }), chips, count,
      h('div.sheet-actions', h('button.btn', { text: 'Gem samling', onclick: () => {
        const nm = name.value.trim() || q.value.trim() || 'Smart samling';
        const keys = [...st.keys]; const filters = { ...filtersFromKeys(keys), folderId: st.folderId || undefined };
        delete filters.since; // recomputed on read via keys
        Store.upsert('smart', { id: existing?.id || uid('s'), name: nm, q: q.value.trim(), keys, filters: { ...filters, ...(keys.some(k => k.startsWith('since')) ? {} : {}) } });
        sheet.close(); haptic.ok(); Nav.refresh();
      } })));
  } });
}
// Smart filters with relative dates are recomputed every time they are read.
const _origRun = Search.run.bind(Search);
Search.run = function (q, filters = {}) {
  if (filters && filters.sinceDays) filters = { ...filters, since: now() - filters.sinceDays * 86400000 };
  return _origRun(q, filters);
};
function smartActions(s) {
  UI.menu(s.name, [{ icon: 'smart', label: 'Redigér', onClick: () => editSmart(s) }, { icon: 'trash', label: 'Slet samling', danger: true, onClick: () => { Store.remove('smart', s.id); Nav.refresh(); } }]);
}

/* ---------- Search ---------- */
function openSearch(initial = '') {
  const el = h('section.screen.paper');
  const input = h('input#search-input', { type: 'search', placeholder: 'Søg i alle noter', value: initial, autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'search', 'aria-label': 'Søg' });
  const bar = h('div.search-bar', h('label.search-field', { html: icon('search', 'sm') }, input), h('button.textbtn', { text: 'Annullér', onclick: () => Nav.pop() }));
  const keys = new Set();
  const chips = h('div.chips', { style: { margin: '0', padding: '0 16px 8px' } });
  [['has:open', 'Åbne opgaver'], ['has:image', 'Billeder'], ['has:att', 'Filer'], ['flag:fav', 'Favoritter'], ['since:7', '7 dage'], ['scope:arch', 'Inkl. arkiv']].forEach(([k, l]) => {
    const c = h('button.chip', { text: l, onclick: () => { keys.has(k) ? keys.delete(k) : keys.add(k); c.classList.toggle('on'); run(); } }); chips.append(c);
  });
  const scroll = h('div.scroll'); const wrap = h('div.wrap', { style: { paddingBottom: '120px' } }); scroll.append(wrap);
  el.append(bar, chips, scroll);
  const screen = { el, noFab: true, render: () => run(), onShow: () => setTimeout(() => input.focus(), 350) };
  let aiCtl = null;

  async function run() {
    const q = input.value.trim(); wrap.innerHTML = '';
    const filters = filtersFromKeys([...keys]); if (keys.has('scope:arch')) filters.scope = 'all';
    if (!q && !keys.size) {
      const recent = (await Store.kvGet('recentSearches')) || [];
      if (recent.length) {
        wrap.append(h('div.datehead', { text: 'Seneste søgninger' }));
        const c = h('div.tagcloud'); recent.forEach(r => c.append(h('button.chip', { text: r, onclick: () => { input.value = r; run(); } }))); wrap.append(c);
      }
      const tags = Store.allTags().slice(0, 16);
      if (tags.length) { wrap.append(h('div.datehead', { text: 'Tags' })); const c = h('div.tagcloud'); tags.forEach(([t]) => c.append(h('button.tagchip', { text: '#' + t, onclick: () => { input.value = '#' + t; run(); } }))); wrap.append(c); }
      wrap.append(h('p', { style: { color: 'var(--ink-3)', fontSize: '14px', marginTop: '24px' }, html: 'Tip: skriv <b>#tag</b> for at filtrere. Søgningen tåler stavefejl' + (AI.available ? ', og <b>Søg efter betydning</b> finder noter, selv når du ikke kan huske ordene.' : '.') }));
      return;
    }
    const res = Search.run(q, filters);
    if (q && AI.available) {
      wrap.append(h('button.mi', { style: { background: 'var(--accent-soft)', borderRadius: '14px', marginBottom: '14px', color: 'var(--accent)', fontWeight: 600 }, html: icon('spark') + `<span>Søg efter betydning: "${esc(q)}"</span>`, onclick: () => semantic(q) }));
    }
    wrap.append(h('div.listhead', h('span.count', { text: `${res.length} ${res.length === 1 ? 'resultat' : 'resultater'}` }),
      (q || keys.size) ? h('button.textbtn', { text: 'Gem som samling', onclick: () => editSmart(null, { name: q, q, keys: [...keys].filter(k => !k.startsWith('scope')) }) }) : null));
    if (!res.length) { wrap.append(UI.empty('search', 'Ingen fund', AI.available && q ? 'Prøv "Søg efter betydning" ovenfor. Den forstår, hvad du mener.' : 'Prøv et andet ord eller fjern et filter.')); return; }
    const list = h('div.list'); res.slice(0, 80).forEach(r => list.append(noteRow(r.n, { q, onOpen: n => { saveRecent(q); openNote(n.id, { highlight: q }); } }))); wrap.append(list);
  }
  async function saveRecent(q) { if (!q) return; const r = ((await Store.kvGet('recentSearches')) || []).filter(x => x !== q); r.unshift(q); Store.kvSet('recentSearches', r.slice(0, 8)); }
  async function semantic(q) {
    saveRecent(q);
    aiCtl && aiCtl.abort(); aiCtl = new AbortController();
    wrap.innerHTML = '';
    const box = h('div.ai-answer', h('div.h', { html: icon('spark', 'xs') + 'Søger efter betydning' }), h('div.shimmer'), h('div.shimmer', { style: { width: '70%' } }));
    wrap.append(box);
    try {
      const r = await AI.semanticSearch(q, aiCtl.signal);
      box.innerHTML = `<div class="h">${icon('spark', 'xs')} ${r.matches.length ? 'Det bedste match' : 'Intet sikkert match'}</div><div>${esc(r.answer || '')}</div>`;
      if (r.matches.length) {
        const list = h('div.list');
        r.matches.forEach(m => { const n = Store.get(m.id); if (!n) return; const row = noteRow(n); const why = h('div.row-snip', { style: { color: 'var(--accent)' }, text: m.why || '' }); row.querySelector('.row-main').append(why); list.append(row); });
        wrap.append(list);
      }
    } catch (e) { if (e.name !== 'AbortError') box.innerHTML = `<div class="h">${icon('info', 'xs')} Kunne ikke søge</div>${esc(AI.errorText(e))}`; }
  }
  input.addEventListener('input', debounce(run, 90));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { input.blur(); saveRecent(input.value.trim()); } });
  run();
  Nav.push(screen);
}

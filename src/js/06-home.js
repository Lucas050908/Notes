/* ===== 06-home: the home screen ===== */

Screens.home = (() => {
  const el = h('section.screen');
  const scroll = h('div.scroll'); const wrap = h('div.wrap.tab-pad'); scroll.append(wrap); el.append(scroll);
  let captureText = '';

  function render() {
    const name = Store.setting('name');
    const notes = Store.active();
    const focused = document.activeElement && document.activeElement.id === 'capture';
    if (focused) return; // never rebuild under the user's thumb
    wrap.innerHTML = '';

    // Header
    wrap.append(h('div.home-head',
      h('div', h('div.eyebrow', { text: fmtLongDate() }), h('h1.greet', { text: greeting(name) })),
      h('button.avatar', { 'aria-label': 'Indstillinger', title: 'Indstillinger', html: name ? esc(name[0].toUpperCase()) : icon('gear', 'sm'), onclick: () => openSettings() })));

    if (Sync.state === 'error' || (Sync.state === 'local' && !IDB.persistent)) {
      wrap.append(h('div.banner', { html: `<span class="sync-dot err"></span><span>${esc(Sync.message || 'Lokal lagring er ikke tilgængelig i denne visning. Åbn appen på claude.ai for at gemme sikkert.')}</span>` }));
    }

    wrap.append(h('button.searchpill', { html: icon('search', 'sm') + '<span>Søg i noter, tags og opgaver</span><kbd>⌘K</kbd>', onclick: () => openSearch() }));

    // Quick capture
    const ta = h('textarea#capture', { rows: 1, placeholder: 'Fang en tanke…', 'aria-label': 'Hurtig note' });
    ta.value = captureText;
    const send = h('button.send', { 'aria-label': 'Gem tanke', html: icon('send', 'sm'), disabled: !captureText.trim() });
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; send.disabled = !ta.value.trim(); captureText = ta.value; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doCapture(); } });
    ta.addEventListener('blur', () => setTimeout(() => { if (Nav.current === 'home' && !Nav.stack.length) render(); }, 150));
    send.onclick = doCapture;
    function doCapture() {
      const txt = ta.value.trim(); if (!txt) return;
      ta.value = ''; captureText = ''; grow(); haptic.ok(); ta.blur();
      quickCapture(txt);
    }
    const mic = h('button.mic.hidden', { 'aria-label': 'Diktér', html: icon('mic', 'sm') });
    Dictation.attach(mic, txt => { ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + txt; grow(); });
    wrap.append(h('div.capture', ta, mic, send));
    requestAnimationFrame(grow);

    // Quick actions
    wrap.append(h('div.chips',
      h('button.chip', { html: icon('journal', 'sm') + 'Dagens note', onclick: () => openDaily() }),
      h('button.chip', { html: icon('people', 'sm') + 'Mødenoter', onclick: () => newFromTemplate('meeting') }),
      h('button.chip', { html: icon('template', 'sm') + 'Skabeloner', onclick: () => templatePicker() }),
      h('button.chip', { html: icon('upload', 'sm') + 'Importér', onclick: () => importFiles() })));

    // Today
    const tasks = Tasks.all().filter(t => !t.done && t.due && dayDiff(parseYmd(t.due), new Date()) <= 0);
    const doneToday = Tasks.all().filter(t => t.done && t.due === ymd()).length;
    if (tasks.length || doneToday) {
      const card = h('div.card.todaycard');
      const total = tasks.length + doneToday;
      card.append(h('div.today-top', h('b', { text: tasks.length ? 'I dag' : 'Alt klaret i dag' }), h('span', { text: `${doneToday} af ${total}` })),
        h('div.progress', h('i', { style: { width: (total ? doneToday / total * 100 : 0) + '%' } })));
      const list = h('div', { style: { margin: '0 -16px' } });
      tasks.slice(0, 4).forEach(t => list.append(Tasks.row(t, { compact: true })));
      card.append(list);
      if (tasks.length > 4) card.append(h('button.textbtn', { style: { margin: '2px -10px 4px' }, text: `Vis alle ${tasks.length}`, onclick: () => Nav.tab('tasks') }));
      wrap.append(h('div.section', card));
    }

    if (!notes.length) {
      wrap.append(h('div.section', UI.empty('notes', 'Et tomt ark', 'Tryk på + for at skrive din første note, eller fang en tanke ovenfor.', { label: 'Skriv en note', onClick: () => newNote() })));
      return;
    }

    // Pinned
    const pinned = notes.filter(n => n.pinned);
    if (pinned.length) {
      const hs = h('div.hscroll');
      pinned.forEach(n => hs.append(stickyCard(n)));
      wrap.append(h('div.section', h('div.sec-head', h('h2', { text: 'Fastgjort' })), hs));
    }

    // Recent
    const recent = notes.filter(n => !n.pinned).slice(0, 6);
    if (recent.length) {
      const list = h('div.sticky-grid');
      recent.forEach(n => list.append(stickyCard(n)));
      wrap.append(h('div.section', h('div.sec-head', h('h2', { text: 'Seneste' }), h('button', { text: 'Alle noter', onclick: () => openList({ title: 'Alle noter' }) })), list));
    }

    // Favorites
    const favs = notes.filter(n => n.favorite);
    if (favs.length) {
      const c = h('div.chips', { style: { marginTop: 0 } });
      favs.slice(0, 12).forEach(n => c.append(h('button.chip', { html: `<span class="mini-ico star">${icon('star', 'xs')}</span>${esc(noteTitle(n))}`, onclick: () => openNote(n.id) })));
      wrap.append(h('div.section', h('div.sec-head', h('h2', { text: 'Favoritter' }), h('button', { text: 'Vis', onclick: () => openList({ title: 'Favoritter', filters: { flag: 'favorite' } }) })), c));
    }

    // Folders & collections
    const folders = Store.entities('folders').filter(f => !f.parentId).slice(0, 5);
    const smart = Store.entities('smart').slice(0, 3);
    const g = h('div.grid2');
    folders.forEach(f => g.append(folderTile(f)));
    smart.forEach(s => g.append(h('button.tile', { onclick: () => openSmart(s) },
      h('div.ti', { style: { background: 'var(--ink-2)' }, html: icon('smart', 'sm') }),
      h('div', h('b', { text: s.name }), h('small', { text: `${Search.run(s.q || '', s.filters || {}).length} noter` })))));
    g.append(h('button.tile', { onclick: async () => { const f = await createFolder(); if (f) render(); } },
      h('div.ti', { style: { background: 'var(--fill-2)', color: 'var(--ink-2)' }, html: icon('plus', 'sm') }), h('div', h('b', { text: 'Ny mappe' }), h('small', { text: 'Organisér noter' }))));
    wrap.append(h('div.section', h('div.sec-head', h('h2', { text: 'Mapper og samlinger' }), h('button', { text: 'Alle', onclick: () => Nav.tab('notes') })), g));

    // Activity
    wrap.append(h('div.section', h('div.sec-head', h('h2', { text: 'Aktivitet' })), activityCard()));
  }

  function pinCard(n) {
    const d = Store.d(n);
    const body = d.text.replace(/\s+/g, ' ').trim();
    const t = noteTitle(n);
    return h('button.pcard', { onclick: () => openNote(n.id), oncontextmenu: e => { e.preventDefault(); noteActions(n); } },
      h('h3', { text: t }), h('p', { text: body.startsWith(t) && !n.title ? body.slice(t.length) : body }),
      h('div.meta', { html: `${icon('pin', 'xs')} ${fmtRel(n.updatedAt)}` }));
  }
  function folderTile(f) {
    const ids = Store.folderDescendants(f.id);
    const count = Store.active().filter(n => ids.has(n.folderId)).length;
    return h('button.tile', { onclick: () => openFolder(f.id) },
      h('div.ti', { style: { background: f.color }, html: icon('folder', 'sm') }),
      h('div', h('b', { text: f.name }), h('small', { text: `${count} ${count === 1 ? 'note' : 'noter'}` })));
  }
  function activityCard() {
    const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(new Date(), -i));
    const act = (Store.activity && Store.activity.days) || {};
    const touched = new Set(); let max = 1;
    const vals = days.map(d => { const a = act[ymd(d)]; (a?.notes || []).forEach(x => touched.add(x)); const v = a ? a.edits + a.created * 4 : 0; max = Math.max(max, v); return v; });
    const weekNotes = Store.active().filter(n => n.updatedAt > addDays(new Date(), -7).getTime());
    const words = weekNotes.reduce((s, n) => s + Store.d(n).words, 0);
    return h('div.card.activity',
      h('div', h('div.num', { text: weekNotes.length }), h('div.lbl', { text: `${weekNotes.length === 1 ? 'note' : 'noter'} redigeret de sidste 7 dage · ${words.toLocaleString('da-DK')} ord` })),
      h('div.bars', { 'aria-label': 'Aktivitet pr. dag' }, days.map((d, i) => h('div',
        h('i' + (vals[i] ? '.on' : ''), { style: { height: (4 + vals[i] / max * 40) + 'px' } }), h('span', { text: DA_DAYS_S[d.getDay()][0].toUpperCase() })))));
  }

  return { el, render };
})();

function quickCapture(text) {
  const { date, rest } = parseNaturalDate(text);
  const looksTask = /^(\[\]|todo:|husk|køb|ring|send|book|bestil)\b/i.test(text) || !!date;
  if (looksTask) {
    Tasks.add(rest.replace(/^(\[\]|todo:)\s*/i, ''), date);
    UI.toast(date ? `Opgave tilføjet · ${fmtDue(date)}` : 'Opgave tilføjet', { action: 'Vis', onAction: () => Nav.tab('tasks') });
  } else {
    const [first, ...more] = text.split('\n');
    const title = first.length <= 60 ? first : '';
    const body = title ? more.join('\n') : text;
    const n = Store.create({ title, html: MD.toHtml(body) || '<p></p>', tags: ['indbakke'] });
    UI.toast('Gemt i indbakken', { action: 'Åbn', onAction: () => openNote(n.id) });
  }
  Nav.refresh();
}

/* ===== 09-tasks: tasks (checklist items across notes), habits, daily notes, templates ===== */

const Tasks = {
  all() {
    const out = [];
    for (const n of Store.active()) for (const t of Store.d(n).tasks) out.push({ ...t, noteId: n.id, noteTitle: noteTitle(n), noteUpdated: n.updatedAt });
    return out;
  },
  mutate(t, fn) {
    const n = Store.get(t.noteId); if (!n) return;
    const tpl = document.createElement('template'); tpl.innerHTML = n.html;
    const li = $$('ul.checklist > li', tpl.content)[t.i]; if (!li) return;
    fn(li, tpl.content);
    Store.update(n.id, { html: tpl.innerHTML });
    Bus.emit('notes', { id: n.id, type: 'remote' });
  },
  toggle(t) { this.mutate(t, li => li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true')); },
  setDue(t, d) {
    this.mutate(t, li => {
      li.querySelector(':scope > .due')?.remove();
      if (d) { const x = document.createElement('template'); x.innerHTML = dueChip(d); const sub = li.querySelector(':scope > ul, :scope > ol'); sub ? sub.before(x.content.firstChild) : li.append(x.content.firstChild); }
    });
  },
  remove(t) { this.mutate(t, li => { const ul = li.parentNode; li.remove(); if (!ul.children.length) ul.remove(); }); },
  inbox() {
    let n = Store.active().find(x => x.kind === 'tasks');
    if (!n) n = Store.create({ title: 'Opgaver', kind: 'tasks', color: 'green', html: '<p>Opgaver fra hurtig optagelse havner her. Opgaver kan også stå i alle andre noter.</p><ul class="checklist"></ul><p></p>' });
    return n;
  },
  add(text, due) {
    if (!text.trim()) return;
    const n = this.inbox();
    const tpl = document.createElement('template'); tpl.innerHTML = n.html;
    let ul = $$('ul.checklist', tpl.content).pop();
    if (!ul) { ul = document.createElement('ul'); ul.className = 'checklist'; tpl.content.append(ul); }
    const li = document.createElement('li'); li.setAttribute('data-checked', 'false'); li.innerHTML = MD.inline(text) + (due ? dueChip(due) : '');
    ul.append(li);
    Store.update(n.id, { html: tpl.innerHTML });
    Bus.emit('notes', { id: n.id, type: 'remote' });
    haptic.ok();
  },
  row(t, { compact = false } = {}) {
    const row = h('div.task' + (t.done ? '.done' : ''));
    const cb = h('button.cb' + (t.done ? '.on' : ''), { 'aria-label': t.done ? 'Marker som ikke udført' : 'Marker som udført', role: 'checkbox', 'aria-checked': String(t.done), html: icon('check') });
    cb.onclick = (e) => {
      e.stopPropagation(); cb.classList.toggle('on'); row.classList.toggle('done');
      t.done ? haptic.tap() : haptic.ok();
      setTimeout(() => { this.toggle(t); Nav.refresh(); }, t.done ? 0 : 380);
    };
    const tx = h('div.tx', { text: t.text });
    const sub = h('div.sub');
    if (t.due) sub.append(h('span.d.' + (dueClass(t.due) || 'x'), { text: fmtDue(t.due) }));
    if (!compact || true) sub.append(h('span', { text: t.noteTitle }));
    const main = h('div', { style: { flex: 1, minWidth: 0, cursor: 'pointer' }, onclick: () => this.actions(t) }, tx, sub);
    row.append(cb, main);
    return row;
  },
  actions(t) {
    const gcal = t.due ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(t.text)}&dates=${t.due.replace(/-/g, '')}/${ymd(addDays(parseYmd(t.due), 1)).replace(/-/g, '')}&details=${encodeURIComponent('Fra noten "' + t.noteTitle + '" i Notabene')}` : null;
    Sheet.open({ title: t.text.slice(0, 60), build: (body, sheet) => {
      const list = h('div.menu-list');
      list.append(h('button.mi', { html: icon('notes') + `<span>Åbn "${esc(t.noteTitle)}"</span>`, onclick: () => { sheet.close(); openNote(t.noteId, { highlight: t.text.slice(0, 30) }); } }));
      list.append(h('button.mi', { html: icon('cal') + `<span>${t.due ? 'Skift dato' : 'Sæt dato'}</span>` + (t.due ? `<span class="r">${fmtDue(t.due)}</span>` : ''), onclick: () => { sheet.close(); this.dateSheet(t); } }));
      if (gcal) list.append(h('a.mi', { href: gcal, target: '_blank', rel: 'noopener', style: { color: 'inherit', textDecoration: 'none' }, html: icon('share') + '<span>Tilføj til Google Kalender</span>', onclick: () => sheet.close() }));
      list.append(h('button.mi.danger', { html: icon('trash') + '<span>Slet opgave</span>', onclick: () => { sheet.close(); this.remove(t); Nav.refresh(); UI.toast('Opgave slettet'); } }));
      body.append(list);
    } });
  },
  dateSheet(t) {
    Sheet.open({ title: 'Forfaldsdato', build: (body, sheet) => {
      const set = d => { sheet.close(); this.setDue(t, d); Nav.refresh(); };
      const list = h('div.menu-list');
      [['I dag', new Date()], ['I morgen', addDays(new Date(), 1)], ['Om en uge', addDays(new Date(), 7)]].forEach(([l, d]) => list.append(h('button.mi', { html: icon('cal') + `<span>${l}</span>`, onclick: () => set(ymd(d)) })));
      const inp = h('input.input#task-date', { type: 'date', value: t.due || ymd(addDays(new Date(), 1)) });
      body.append(list, h('div.field', { style: { marginTop: '14px' } }, h('label', { for: 'task-date', text: 'Vælg dato' }), inp),
        h('div.sheet-actions', t.due ? h('button.btn.ghost', { text: 'Fjern dato', onclick: () => set(null) }) : null, h('button.btn', { text: 'Sæt dato', onclick: () => inp.value && set(inp.value) })));
    } });
  },
};

Screens.tasks = (() => {
  const el = h('section.screen');
  const scroll = h('div.scroll'); const wrap = h('div.wrap.tab-pad'); scroll.append(wrap); el.append(scroll);
  let mode = 'tasks', showDone = false, draft = '';

  function render() {
    if (document.activeElement && document.activeElement.id === 'task-new') return;
    wrap.innerHTML = '';
    wrap.append(h('div', { style: { paddingTop: 'calc(var(--safe-t) + 18px)' } }, h('h1.bigtitle', { style: { margin: '0 0 14px' }, text: mode === 'tasks' ? 'Opgaver' : 'Vaner' })));
    const seg = h('div.seg', h('button' + (mode === 'tasks' ? '.on' : ''), { text: 'Opgaver', onclick: () => { mode = 'tasks'; render(); } }), h('button' + (mode === 'habits' ? '.on' : ''), { text: 'Vaner', onclick: () => { mode = 'habits'; render(); } }));
    wrap.append(seg);
    mode === 'tasks' ? renderTasks() : renderHabits();
  }

  function renderTasks() {
    const ta = h('textarea#task-new', { rows: 1, placeholder: 'Ny opgave … fx "Ring til tandlæge fredag"', 'aria-label': 'Ny opgave' }); ta.value = draft;
    const hint = h('div', { style: { fontSize: '13px', color: 'var(--accent)', margin: '6px 4px 0', minHeight: '18px' } });
    const send = h('button.send', { 'aria-label': 'Tilføj opgave', html: icon('plus', 'sm'), disabled: !draft.trim() });
    const upd = () => { draft = ta.value; send.disabled = !draft.trim(); const { date } = parseNaturalDate(draft); hint.textContent = date ? `Forfalder ${fmtDue(date).toLowerCase()}` : ''; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    const add = () => { const { date, rest } = parseNaturalDate(ta.value); if (!rest.trim()) return; Tasks.add(rest, date); draft = ''; ta.value = ''; upd(); renderList(); };
    ta.addEventListener('input', upd); ta.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ta && Nav.current === 'tasks') renderList(); }, 200));
    send.onclick = add;
    wrap.append(h('div.capture', { style: { marginTop: '16px' } }, ta, send), hint);
    const listWrap = h('div'); wrap.append(listWrap);
    upd();
    function renderList() {
      listWrap.innerHTML = '';
      const all = Tasks.all(); const open = all.filter(t => !t.done); const done = all.filter(t => t.done);
      if (!all.length) { listWrap.append(UI.empty('tasks', 'Ingen opgaver', 'Skriv en opgave ovenfor, eller lav en tjekliste i en hvilken som helst note. Alle afkrydsningsbokse samles her.')); return; }
      const today = new Date();
      const groups = [['Forfaldne', t => t.due && dayDiff(parseYmd(t.due), today) < 0], ['I dag', t => t.due && dayDiff(parseYmd(t.due), today) === 0], ['I morgen', t => t.due && dayDiff(parseYmd(t.due), today) === 1],
        ['Kommende', t => t.due && dayDiff(parseYmd(t.due), today) > 1], ['Uden dato', t => !t.due]];
      for (const [label, fn] of groups) {
        const items = open.filter(fn).sort((a, b) => (a.due || '').localeCompare(b.due || '') || b.noteUpdated - a.noteUpdated);
        if (!items.length) continue;
        const list = h('div.list'); items.forEach(t => list.append(Tasks.row(t)));
        listWrap.append(h('div.section', { style: { marginTop: '22px' } }, h('div.sec-head', h('h2', { text: `${label} · ${items.length}` })), list));
      }
      if (!open.length) listWrap.append(h('div.section', UI.empty('check', 'Alt er klaret', 'Der er ingen åbne opgaver. Godt gået.')));
      if (done.length) {
        listWrap.append(h('div.section', { style: { marginTop: '22px' } }, h('div.sec-head', h('h2', { text: `Fuldført · ${done.length}` }), h('button', { text: showDone ? 'Skjul' : 'Vis', onclick: () => { showDone = !showDone; renderList(); } }))));
        if (showDone) { const list = h('div.list'); done.slice(0, 100).forEach(t => list.append(Tasks.row(t))); listWrap.append(list); }
      }
    }
    renderList();
  }

  function renderHabits() {
    const habits = Store.entities('habits');
    const box = h('div.section', { style: { marginTop: '18px' } });
    if (!habits.length) box.append(UI.empty('flame', 'Byg gode vaner', 'Følg små daglige vaner, fx læsning, træning eller at skrive dagbog. Tryk på en dag for at krydse af.'));
    else {
      const card = h('div.card');
      const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(new Date(), -i));
      habits.forEach(hb => {
        const streak = habitStreak(hb);
        const doneWeek = days.filter(d => hb.days?.[ymd(d)]).length;
        const row = h('div.habit',
          h('div.habit-top', h('b', { text: hb.name, oncontextmenu: e => { e.preventDefault(); habitMenu(hb); }, onclick: () => habitMenu(hb), style: { cursor: 'pointer' } }), h('small', { html: `${streak ? `${icon('flame', 'xs')} ${streak} ${streak === 1 ? 'dag' : 'dage'} i træk · ` : ''}${doneWeek}/7` })),
          h('div.week', days.map(d => {
            const k = ymd(d), on = !!hb.days?.[k];
            return h('button' + (on ? '.on' : '') + (k === ymd() ? '.today' : ''), { 'aria-label': `${hb.name} ${fmtLongDate(d)}`, 'aria-pressed': String(on), onclick: () => {
              const nd = { ...(hb.days || {}) }; if (nd[k]) delete nd[k]; else nd[k] = true;
              // keep a year of history
              for (const key of Object.keys(nd)) if (dayDiff(new Date(), parseYmd(key)) > 400) delete nd[key];
              Store.upsert('habits', { id: hb.id, days: nd }); on ? haptic.tap() : haptic.ok(); render();
            } }, h('i', { html: icon('check') }), h('span', { text: DA_DAYS_S[d.getDay()] }));
          })));
        card.append(row);
      });
      box.append(card);
    }
    box.append(h('button.btn.ghost.block', { style: { marginTop: '14px' }, html: icon('plus', 'sm') + ' Ny vane', onclick: async () => {
      const name = await UI.prompt({ title: 'Ny vane', placeholder: 'Fx "Læs 20 minutter"', ok: 'Tilføj' });
      if (name) { Store.upsert('habits', { id: uid('h'), name, days: {}, order: habits.length }); haptic.ok(); render(); }
    } }));
    wrap.append(box);
  }
  function habitMenu(hb) {
    UI.menu(hb.name, [
      { icon: 'text', label: 'Omdøb', onClick: async () => { const n = await UI.prompt({ title: 'Omdøb vane', value: hb.name }); if (n) { Store.upsert('habits', { id: hb.id, name: n }); render(); } } },
      { icon: 'trash', label: 'Slet vane', danger: true, onClick: async () => { if (await UI.confirm({ title: 'Slet vane?', text: 'Historikken for vanen slettes også.', ok: 'Slet', danger: true })) { Store.remove('habits', hb.id); render(); } } },
    ]);
  }
  return { el, render };
})();
function habitStreak(hb) {
  let d = new Date(), s = 0; if (!hb.days?.[ymd(d)]) d = addDays(d, -1);
  while (hb.days?.[ymd(d)]) { s++; d = addDays(d, -1); }
  return s;
}

/* ---------- Daily notes ---------- */
function openDaily(date = new Date()) {
  const k = ymd(date);
  let n = Store.active().find(x => x.kind === 'daily' && x.dailyDate === k);
  if (!n) {
    const d = new Date(date);
    const title = `${DA_DAYS[d.getDay()].replace(/^./, c => c.toUpperCase())} ${d.getDate()}. ${DA_MON[d.getMonth()]} ${d.getFullYear()}`;
    n = Store.create({ title, kind: 'daily', dailyDate: k, tags: ['dagbog'], color: 'blue', html: fillTemplate(TEMPLATES.daily.html) });
  }
  openNote(n.id);
}

/* ---------- Templates ---------- */
const TEMPLATES = {
  blank: { name: 'Tom note', icon: 'notes', html: '<p></p>' },
  meeting: { name: 'Mødenoter', icon: 'people', color: 'green', title: 'Møde · {{kort}}', tags: ['møde'], html: '<p><strong>Dato:</strong> {{dato}}<br><strong>Deltagere:</strong> </p><h2>Dagsorden</h2><ol><li><br></li></ol><h2>Noter</h2><p><br></p><h2>Beslutninger</h2><ul><li><br></li></ul><h2>Handlingspunkter</h2><ul class="checklist"><li data-checked="false"><br></li></ul>' },
  daily: { name: 'Dagbog', icon: 'journal', color: 'blue', html: '<h2>Tre ting i dag</h2><ul class="checklist"><li data-checked="false"><br></li><li data-checked="false"><br></li><li data-checked="false"><br></li></ul><h2>Tanker</h2><p><br></p><h2>Taknemmelig for</h2><p><br></p>' },
  project: { name: 'Projektplan', icon: 'target', color: 'orange', title: 'Projekt: ', tags: ['projekt'], html: '<h2>Mål</h2><p>Hvad skal være sandt, når projektet er færdigt?</p><h2>Hvorfor</h2><p><br></p><h2>Milepæle</h2><ul class="checklist"><li data-checked="false"><br></li></ul><h2>Risici</h2><ul><li><br></li></ul><h2>Ressourcer</h2><p><br></p>' },
  week: { name: 'Ugeplan', icon: 'cal', color: 'purple', title: 'Uge {{uge}}', tags: ['ugeplan'], html: '<h2>Ugens fokus</h2><p><br></p><h2>Vigtigste opgaver</h2><ul class="checklist"><li data-checked="false"><br></li></ul><h2>Mandag</h2><p><br></p><h2>Tirsdag</h2><p><br></p><h2>Onsdag</h2><p><br></p><h2>Torsdag</h2><p><br></p><h2>Fredag</h2><p><br></p><h2>Refleksion</h2><p><br></p>' },
  idea: { name: 'Idé', icon: 'bulb', color: 'pink', tags: ['idé'], html: '<h2>Idéen i én sætning</h2><p><br></p><h2>Problemet den løser</h2><p><br></p><h2>Næste skridt</h2><ul class="checklist"><li data-checked="false"><br></li></ul>' },
  reading: { name: 'Læsenoter', icon: 'book', color: 'white', tags: ['læsning'], html: '<p><strong>Forfatter:</strong> <br><strong>Læst:</strong> {{dato}}</p><h2>Hovedpointer</h2><ul><li><br></li></ul><h2>Citater</h2><blockquote><br></blockquote><h2>Hvad jeg tager med</h2><p><br></p>' },
};
function isoWeek(d) { d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return Math.ceil(((d - y) / 86400000 + 1) / 7); }
function fillTemplate(s) {
  const d = new Date();
  return String(s || '').replace(/\{\{dato\}\}/g, `${d.getDate()}. ${DA_MON[d.getMonth()]} ${d.getFullYear()}`).replace(/\{\{kort\}\}/g, `${d.getDate()}. ${DA_MON_S[d.getMonth()]}`)
    .replace(/\{\{uge\}\}/g, isoWeek(d)).replace(/\{\{tid\}\}/g, `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`);
}
function newFromTemplate(key, extra = {}) {
  if (key === 'daily') return openDaily();
  const t = TEMPLATES[key] || Store.entity('templates', key); if (!t) return newNote(extra);
  return newNote({ title: fillTemplate(t.title || ''), html: fillTemplate(t.html), tags: [...(t.tags || [])], color: t.color || 'yellow', ...extra });
}
function templatePicker() {
  Sheet.open({ title: 'Ny fra skabelon', build: (body, sheet) => {
    const list = h('div.menu-list');
    Object.entries(TEMPLATES).forEach(([k, t]) => list.append(h('button.mi', { html: icon(t.icon) + `<span>${t.name}</span>`, onclick: () => { sheet.close(); newFromTemplate(k); } })));
    body.append(list);
    const own = Store.entities('templates');
    if (own.length) {
      body.append(h('div.fmt-label', { text: 'Dine skabeloner' }));
      const l2 = h('div.menu-list');
      own.forEach(t => {
        const b = h('button.mi', { html: icon('template') + `<span>${esc(t.name)}</span>`, onclick: () => { sheet.close(); newFromTemplate(t.id); } });
        const del = h('span.r', { html: icon('trash', 'sm'), role: 'button', 'aria-label': 'Slet skabelon', onclick: async e => { e.stopPropagation(); if (await UI.confirm({ title: 'Slet skabelon?', text: t.name, ok: 'Slet', danger: true })) { Store.remove('templates', t.id); b.remove(); } } });
        b.append(del); l2.append(b);
      });
      body.append(l2);
    }
    body.append(h('p', { style: { color: 'var(--ink-3)', fontSize: '13px', marginTop: '14px' }, text: 'Gem en hvilken som helst note som skabelon via ••• i noten.' }));
  } });
}

/* ---------- Reminders: native notifications for dated tasks (Android app) ---------- */
const Reminders = {
  get LN() { return Native.on ? Native.plugin('LocalNotifications') : null; },
  get supported() { return !!this.LN; },
  init() {
    if (!this.supported) return;
    try { this.LN.addListener('localNotificationActionPerformed', ev => { const id = ev && ev.notification && ev.notification.extra && ev.notification.extra.noteId; if (id && Store.get(id)) openNote(id); }); } catch (e) {}
    Bus.on('notes', e => { if (!e || e.type !== 'closed') this.schedule(); });
    Bus.on('settings', () => this.schedule());
    this.schedule();
  },
  hash(s) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x) % 2000000000 + 1; },
  async permitted(ask) {
    try {
      let p = await this.LN.checkPermissions();
      if (p.display !== 'granted' && ask) p = await this.LN.requestPermissions();
      return p.display === 'granted';
    } catch (e) { return false; }
  },
  schedule: debounce(async function () {
    const R = Reminders; if (!R.supported) return;
    try {
      const pending = await R.LN.getPending();
      if (pending && pending.notifications && pending.notifications.length) await R.LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      if (Store.setting('remind') === false) return;
      const [hh, mm] = String(Store.setting('remindAt') || '09:00').split(':').map(Number);
      const nowMs = now();
      const items = Tasks.all().filter(t => !t.done && t.due).map(t => { const d = parseYmd(t.due); d.setHours(hh || 0, mm || 0, 0, 0); return { t, at: d }; })
        .filter(x => x.at.getTime() > nowMs + 30000).sort((a, b) => a.at - b.at).slice(0, 60);
      if (!items.length) return;
      const asked = await Store.kvGet('remindAsked');
      if (!await R.permitted(!asked)) { Store.kvSet('remindAsked', true); return; }
      Store.kvSet('remindAsked', true);
      await R.LN.schedule({ notifications: items.map(({ t, at }) => ({
        id: R.hash(t.noteId + '|' + t.text), title: t.text.slice(0, 120), body: `${fmtDue(t.due)} · ${t.noteTitle}`,
        schedule: { at, allowWhileIdle: true }, extra: { noteId: t.noteId }, smallIcon: 'ic_stat_notabene', iconColor: '#F3D867',
      })) });
    } catch (e) { console.warn('reminders', e); }
  }, 2000),
};

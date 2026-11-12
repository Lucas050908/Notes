/* ===== 11-settings: settings, export/import, file saving, dictation, onboarding, native bridge ===== */

const Native = {
  cap: window.Capacitor,
  get on() { try { return !!(this.cap && this.cap.isNativePlatform && this.cap.isNativePlatform()); } catch (e) { return false; } },
  plugin(name) { try { return this.cap && this.cap.registerPlugin ? this.cap.registerPlugin(name) : (this.cap && this.cap.Plugins && this.cap.Plugins[name]); } catch (e) { return null; } },
  init() {
    if (!this.on) return;
    const Haptics = this.plugin('Haptics');
    if (Haptics) {
      haptic.tap = () => { Haptics.impact({ style: 'LIGHT' }).catch(() => {}); };
      haptic.ok = () => { Haptics.notification({ type: 'SUCCESS' }).catch(() => {}); };
      haptic.warn = () => { Haptics.notification({ type: 'WARNING' }).catch(() => {}); };
    }
    const App = this.plugin('App');
    if (App) App.addListener('backButton', () => {
      if (Pop.cur) return Pop.close();
      if (Sheet.stack.length) return Sheet.stack[Sheet.stack.length - 1].close();
      if (document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName) && KB.open) return document.activeElement.blur();
      if (Nav.stack.length) return Nav.pop();
      if (Nav.current !== 'home') return Nav.tab('home');
      App.minimizeApp && App.minimizeApp();
    });
    if (App) App.addListener('pause', () => { const t = Nav.top(); if (t && t.noteId) Nav.stack.forEach(s => s.noteId && s.flushSave && s.flushSave()); Bus.emit('pause'); });
    this.statusBar();
    Bus.on('settings', () => this.statusBar());
  },
  statusBar() {
    const SB = this.plugin('StatusBar'); if (!SB) return;
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    SB.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
    SB.setBackgroundColor && SB.setBackgroundColor({ color: dark ? '#0b0c0f' : '#f4f5f7' }).catch(() => {});
  },
};

/** Save a file for the user: native share sheet in the Android app, the downloads capability on claude.ai, or a plain download. */
async function saveFile(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/.test(filename) ? 'application/json' : 'text/markdown' });
  if (Native.on) {
    try {
      const FS = Native.plugin('Filesystem'), Share = Native.plugin('Share');
      const b64 = (await readFileAsDataURL(blob)).split(',')[1];
      const w = await FS.writeFile({ path: filename, data: b64, directory: 'CACHE' });
      await Share.share({ title: filename, files: [w.uri], dialogTitle: 'Gem eller del ' + filename });
      return true;
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) UI.toast('Kunne ikke gemme filen: ' + ((e && e.message) || 'ukendt fejl')); return false; }
  }
  if (window.claude && window.claude.use) {
    try { const dl = await window.claude.use('downloads'); if (dl) { await dl.save({ filename, data: blob }); return true; } } catch (e) { if (e && e.code === 'declined') return false; if (e && e.code === 'rejected_extension') { UI.toast('Den filtype kan ikke downloades her'); return false; } }
  }
  try { const a = h('a', { href: URL.createObjectURL(blob), download: filename }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return true; }
  catch (e) { UI.toast('Download er ikke tilgængelig her'); return false; }
}

/* ---------- Dictation: claude.ai capability or the Web Speech API when present ---------- */
const Dictation = {
  attach(btn, onText) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const useClaude = async () => { try { return window.claude && window.claude.use ? await window.claude.use('dictation') : null; } catch (e) { return null; } };
    if (SR && !Native.on) { btn.classList.remove('hidden'); }
    useClaude().then(d => { if (d) { btn.classList.remove('hidden'); btn._d = d; } });
    let rec = null;
    btn.onclick = () => {
      if (btn._d) {
        const d = btn._d;
        if (btn.classList.contains('live')) { d.stop().catch(() => {}); return; }
        d.onFinal(({ text }) => onText(text)); d.onState(({ state }) => btn.classList.toggle('live', state === 'listening'));
        d.start().catch(e => { btn.classList.remove('live'); if (e && e.code === 'not_granted') btn.classList.add('hidden'); });
        return;
      }
      if (!SR) return;
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'da-DK'; rec.interimResults = false;
      rec.onresult = e => onText([...e.results].map(r => r[0].transcript).join(' '));
      rec.onend = () => { rec = null; btn.classList.remove('live'); };
      rec.onerror = () => { rec = null; btn.classList.remove('live'); };
      btn.classList.add('live'); rec.start();
    };
  },
};

/* ---------- Theme ---------- */
function applyTheme() {
  const t = Store.setting('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  document.documentElement.style.setProperty('--ed-size', (Store.setting('edSize') || 17) + 'px');
}

/* ---------- Settings screen ---------- */
function openSettings() {
  const s = makeScreen({ title: 'Indstillinger', back: 'Hjem' });
  s.render = () => {
    $$(':scope > :not(.bigtitle)', s.wrap).forEach(x => x.remove());
    const group = (label, ...items) => [h('div.fmt-label', { text: label }), h('div.menu-list', ...items)];
    const item = (ic, label, right, onClick, cls = '') => h('button.mi' + cls, { html: icon(ic) + `<span>${label}</span>` + (right != null ? `<span class="r">${right}</span>` : ''), onclick: onClick });
    const name = Store.setting('name');
    const theme = Store.setting('theme'), size = Store.setting('edSize') || 17;
    const notes = Store.active().length, all = Store.notes.size;
    s.wrap.append(
      ...group('Profil', item('people', 'Navn', esc(name || 'Ikke angivet'), async () => { const v = await UI.prompt({ title: 'Hvad hedder du?', value: name, placeholder: 'Fornavn' }); if (v != null) { Store.setSetting('name', v); s.render(); } })),
      ...group('Udseende',
        item('sun', 'Tema', ({ system: 'Følg systemet', light: 'Lyst', dark: 'Mørkt' })[theme], () => UI.menu('Tema', [['system', 'Følg systemet'], ['light', 'Lyst'], ['dark', 'Mørkt']].map(([k, l]) => ({ label: l, right: k === theme ? icon('check', 'sm') : '', onClick: () => { Store.setSetting('theme', k); applyTheme(); s.render(); } })))),
        item('text', 'Skriftstørrelse i noter', ({ 15: 'Lille', 17: 'Normal', 19: 'Stor', 21: 'Ekstra stor' })[size] || size, () => UI.menu('Skriftstørrelse', [[15, 'Lille'], [17, 'Normal'], [19, 'Stor'], [21, 'Ekstra stor']].map(([k, l]) => ({ label: l, right: k === size ? icon('check', 'sm') : '', onClick: () => { Store.setSetting('edSize', k); applyTheme(); s.render(); } }))))),
      ...group('AI',
        item('spark', AI.provider === 'claude' ? 'AI via Claude' : 'Anthropic API-nøgle', AI.provider === 'claude' ? 'Aktiv' : AI.key ? '••••' + esc(AI.key.slice(-4)) : 'Ikke sat', () => apiKeySheet()),
        AI.provider === 'api' ? item('wand', 'Model', esc(AI.model), () => UI.menu('Model', [['claude-sonnet-5-5', 'Sonnet 5.5 · anbefalet'], ['claude-haiku-5-5', 'Haiku 5.5 · hurtigst og billigst'], ['claude-opus-5-5', 'Opus 5.5 · stærkest']].map(([k, l]) => ({ label: l, right: k === AI.model ? icon('check', 'sm') : '', onClick: async () => { AI.model = k; await Store.kvSet('aiModel', k); s.render(); } })))) : null),
      ...group('Data',
        h('div.mi', { html: icon(Sync.state === 'local' ? 'lock' : 'cloud') + `<span>${Sync.state === 'local' ? 'Gemt på denne enhed' : 'Synkronisering'}<small style="display:block;color:var(--ink-3);font-size:13px">${esc(Sync.state === 'local' ? (IDB.persistent ? 'Fungerer helt offline. Tag backup jævnligt.' : 'Lagring er midlertidig i denne visning.') : (Sync.message || Sync.label()))}</small></span><span class="r"><span class="sync-dot ${Sync.state === 'synced' || Sync.state === 'local' ? 'ok' : Sync.state === 'error' ? 'err' : 'busy'}"></span></span>` }),
        item('download', 'Tag backup (JSON)', `${all} noter`, () => exportBackup()),
        item('download', 'Eksportér som Markdown (zip)', null, () => exportMarkdownZip()),
        item('upload', 'Importér', 'MD, TXT, HTML, JSON, ENEX', () => importFiles())),
      ...group('Papirkurv', item('trash', 'Slet automatisk efter', `${Store.setting('trashDays') || 30} dage`, () => UI.menu('Slet efter', [7, 30, 90, 365].map(d => ({ label: `${d} dage`, right: d === (Store.setting('trashDays') || 30) ? icon('check', 'sm') : '', onClick: () => { Store.setSetting('trashDays', d); s.render(); } }))))),
      h('div.fmt-label', { text: 'Om' }),
      h('div.card', { style: { padding: '16px', fontSize: '14px', color: 'var(--ink-2)', lineHeight: 1.55 } },
        h('div', { style: { font: '600 22px var(--font-display)', color: 'var(--ink)', marginBottom: '6px' }, text: 'Notabene' }),
        h('p', { style: { margin: '0 0 8px' }, text: `Version ${APP_VERSION} · ${notes} aktive noter.` }),
        h('p', { style: { margin: 0 }, text: 'Dine noter gemmes på din enhed. De forlader den kun, når du selv eksporterer, eller når du bruger AI. Så sendes den tekst, du arbejder med, til Anthropic for at blive behandlet.' })),
      h('div.menu-list', { style: { marginTop: '22px' } }, item('trash', 'Slet alle data på denne enhed', null, async () => {
        if (!await UI.confirm({ title: 'Slet alt?', text: 'Alle noter, mapper, vaner og indstillinger slettes fra denne enhed. Tag en backup først, hvis du er i tvivl.', ok: 'Slet alt', danger: true })) return;
        if (!await UI.confirm({ title: 'Er du helt sikker?', text: 'Det kan ikke fortrydes.', ok: 'Ja, slet alt', danger: true })) return;
        for (const st of ['notes', 'blobs', 'versions', 'kv']) await IDB.clear(st).catch(() => {});
        try { localStorage.clear(); } catch (e) {}
        location.reload();
      }, '.danger')),
    );
  };
  s.render(); Nav.push(s);
}

function apiKeySheet() {
  if (AI.provider === 'claude') return UI.toast('AI kører via din Claude-konto her. Ingen nøgle nødvendig.');
  Sheet.open({ title: 'Anthropic API-nøgle', build: (body, sheet) => {
    const inp = h('input.input#api-key', { type: 'password', placeholder: 'sk-ant-…', value: AI.key || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const status = h('div', { style: { fontSize: '14px', minHeight: '20px', marginTop: '8px' } });
    body.append(
      h('p', { style: { color: 'var(--ink-2)', fontSize: '14px', margin: '0 0 14px', lineHeight: 1.5 }, html: 'AI-funktionerne bruger din egen nøgle fra <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style="color:var(--accent)">console.anthropic.com</a>. Nøglen gemmes kun på denne enhed, og du betaler selv for forbruget.' }),
      h('div.field', h('label', { for: 'api-key', text: 'Nøgle' }), inp), status,
      h('div.sheet-actions',
        AI.key ? h('button.btn.ghost', { text: 'Fjern', onclick: async () => { await AI.setKey(''); sheet.close(); UI.toast('Nøglen er fjernet'); } }) : null,
        h('button.btn', { text: 'Gem og test', onclick: async (e) => {
          const k = inp.value.trim(); if (!k) return;
          const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Tester…'; status.textContent = '';
          const prev = AI.key; await AI.setKey(k);
          try { await AI.ask('Svar kun med ordet: OK', { maxTokens: 10 }); sheet.close(); haptic.ok(); UI.toast('AI er slået til'); }
          catch (err) { await AI.setKey(prev || ''); status.style.color = 'var(--danger)'; status.textContent = AI.errorText(err); btn.disabled = false; btn.textContent = 'Gem og test'; }
        } })));
    setTimeout(() => inp.focus(), 300);
  } });
}

/* ---------- Export ---------- */
async function exportBackup() {
  const blobs = await IDB.all('blobs').catch(() => []);
  const data = { app: 'margin', version: 1, exportedAt: new Date().toISOString(), notes: [...Store.notes.values()].map(n => { const c = { ...n }; delete c.dirty; delete c.baseWid; delete c.localSeq; return c; }), meta: Store.meta, blobs };
  const ok = await saveFile(`notabene-backup-${ymd()}.json`, JSON.stringify(data));
  if (ok) { Store.kvSet('lastBackup', now()); UI.toast('Backup klar'); }
}
async function exportMarkdownZip() {
  if (!window.JSZip) return UI.toast('Zip er ikke tilgængelig');
  const zip = new JSZip(); const used = new Set();
  for (const n of Store.list().concat(Store.list({ archived: true }))) {
    const path = Store.folderPath(n.folderId).map(f => safeName(f.name)).join('/');
    let name = safeName(noteTitle(n)), k = 1; while (used.has(path + '/' + name)) name = `${safeName(noteTitle(n))} (${++k})`; used.add(path + '/' + name);
    const front = `---\ntitle: "${(n.title || noteTitle(n)).replace(/"/g, '\\"')}"\ncreated: ${new Date(n.createdAt).toISOString()}\nupdated: ${new Date(n.updatedAt).toISOString()}\n${(n.tags || []).length ? `tags: [${n.tags.join(', ')}]\n` : ''}${n.archived ? 'archived: true\n' : ''}---\n\n`;
    zip.file((path ? path + '/' : '') + name + '.md', front + MD.fromHtml(n.html));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  if (await saveFile(`notabene-noter-${ymd()}.zip`, blob)) UI.toast('Eksport klar');
}

/* ---------- Import ---------- */
function importFiles() {
  const inp = h('input', { type: 'file', multiple: true, accept: '.md,.markdown,.txt,.html,.htm,.json,.enex,text/*,application/json', style: { display: 'none' } });
  inp.onchange = async () => {
    const files = [...inp.files]; inp.remove(); if (!files.length) return;
    let count = 0, errors = 0;
    for (const f of files) {
      try {
        const text = await readFileAsText(f); const ext = fileExt(f.name).toLowerCase();
        if (ext === 'json') count += await importBackup(JSON.parse(text));
        else if (ext === 'enex') count += importEnex(text);
        else if (ext === 'html' || ext === 'htm') { const doc = new DOMParser().parseFromString(text, 'text/html'); Store.create({ title: doc.title || f.name.replace(/\.[^.]+$/, ''), html: sanitizeHtml(doc.body.innerHTML) || '<p></p>', tags: ['importeret'] }); count++; }
        else { importMarkdown(text, f.name); count++; }
      } catch (e) { console.error(e); errors++; }
    }
    haptic.ok(); Nav.refresh();
    UI.toast(errors ? `${count} noter importeret · ${errors} filer kunne ikke læses` : `${count} ${count === 1 ? 'note' : 'noter'} importeret`);
  };
  document.body.append(inp); inp.click();
}
function importMarkdown(text, filename) {
  let title = filename.replace(/\.[^.]+$/, ''), tags = ['importeret'], body = text;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = text.slice(fm[0].length);
    const t = fm[1].match(/^title:\s*"?(.*?)"?\s*$/m); if (t) title = t[1];
    const tg = fm[1].match(/^tags:\s*\[(.*)\]/m); if (tg) tags = tg[1].split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);
  }
  const h1 = body.match(/^#\s+(.+)\n/); if (h1 && body.trimStart().startsWith('#')) { title = h1[1].trim(); body = body.replace(h1[0], ''); }
  Store.create({ title, html: sanitizeHtml(MD.toHtml(body)), tags });
}
function importEnex(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'); let c = 0;
  for (const note of doc.querySelectorAll('note')) {
    const title = note.querySelector('title')?.textContent || 'Evernote-note';
    const content = note.querySelector('content')?.textContent || '';
    const enml = new DOMParser().parseFromString(content, 'text/html');
    $$('en-todo', enml).forEach(td => { const li = enml.createElement('span'); li.textContent = td.getAttribute('checked') === 'true' ? '☑ ' : '☐ '; td.replaceWith(li); });
    const tags = [...note.querySelectorAll('tag')].map(t => t.textContent.toLowerCase().replace(/\s+/g, '-'));
    Store.create({ title, html: sanitizeHtml(enml.body ? enml.body.innerHTML : content) || '<p></p>', tags: tags.length ? tags : ['evernote'] }); c++;
  }
  return c;
}
async function importBackup(data) {
  if (!data || data.app !== 'margin' || !Array.isArray(data.notes)) throw new Error('Ikke en Notabene-backup');
  let c = 0;
  for (const b of data.blobs || []) { if (b && b.id && b.dataUrl) await Store.putBlob(b); }
  for (const n of data.notes) {
    const cur = Store.get(n.id);
    if (cur && cur.updatedAt >= n.updatedAt) continue;
    const note = { ...n, dirty: true, baseWid: cur ? cur.baseWid : null, localSeq: (cur?.localSeq || 0) + 1 };
    Store.notes.set(n.id, note); Store.derived.delete(n.id); Store.persist(note); Sync.queue(n.id); c++;
  }
  if (data.meta) { Sync.mergeMeta(data.meta); Store.saveMeta(); }
  Bus.emit('notes', { type: 'import' });
  return c;
}

/* ---------- Onboarding ---------- */
function onboarding() {
  return new Promise(res => {
    const el = h('div.onb', { role: 'dialog', 'aria-label': 'Velkommen' }); document.body.append(el);
    let step = 0;
    const art = [
      () => h('div.paperstack', h('div', { style: { transform: 'translateX(-90%) rotate(-8deg)' } }, h('i.a'), h('i'), h('i', { style: { width: '70%' } }), h('i')), h('div', { style: { transform: 'translateX(-50%)', zIndex: 2 } }, h('i.a'), h('i'), h('i'), h('i', { style: { width: '50%' } })), h('div', { style: { transform: 'translateX(-10%) rotate(8deg)' } }, h('i.a'), h('i', { style: { width: '80%' } }), h('i'))),
      () => h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--accent)' }, html: '<svg viewBox="0 0 240 180" width="260" height="190" fill="none" stroke="currentColor" stroke-width="2"><circle cx="60" cy="50" r="22" fill="var(--accent-soft)"/><circle cx="180" cy="60" r="26" fill="var(--accent-soft)"/><circle cx="110" cy="140" r="24" fill="var(--accent-soft)"/><circle cx="200" cy="150" r="12" fill="var(--fill)"/><circle cx="30" cy="130" r="10" fill="var(--fill)"/><path d="M80 58l76 0M70 70l30 48M165 82l-40 40M132 146l56 4M38 124l50 12"/></svg>' }),
      () => h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' } }, h('div', { style: { width: '240px', padding: '18px', borderRadius: '20px', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: '15px', lineHeight: 1.5 } }, h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 600, marginBottom: '6px' }, html: icon('spark', 'sm') + 'Assistent' }), h('div', { style: { color: 'var(--ink)' }, text: 'Du har 3 åbne opgaver fra mødet tirsdag, og din idé om havekassen hænger sammen med budgetnoten.' }))),
    ];
    const slides = [
      ['Skriv før du tænker', 'Én tryk, og du skriver. Notabene finder selv ud af resten, så du kan fange tanken, mens den er der.'],
      ['Alt hænger sammen', 'Mapper, tags, links mellem noter og opgaver, der samles ét sted. Dine noter bliver til et system.'],
      ['En assistent, der kender dine noter', 'Opsummér, omskriv, find forbindelser og stil spørgsmål til alt, hvad du har skrevet.'],
    ];
    const draw = () => {
      el.innerHTML = '';
      const isName = step === slides.length;
      const box = h('div.slides.slide-in');
      if (!isName) box.append(h('div.art', art[step]()), h('h1', { text: slides[step][0] }), h('p', { text: slides[step][1] }));
      else {
        const inp = h('input.input#onb-name', { placeholder: 'Dit fornavn', autocomplete: 'given-name', value: Store.setting('name') || '' });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') finish(inp.value); });
        box.append(h('h1', { text: 'Hvad skal vi kalde dig?' }), h('p', { style: { marginBottom: '22px' }, text: 'Så kan Notabene byde dig velkommen. Du kan altid ændre det.' }), inp);
        setTimeout(() => inp.focus(), 400);
      }
      const dots = h('div.dots', [...slides, 0].map((_, i) => h('i' + (i === step ? '.on' : ''))));
      const foot = h('div.foot', dots,
        h('button.btn.block', { text: isName ? 'Kom i gang' : 'Fortsæt', onclick: () => { haptic.tap(); if (isName) finish($('#onb-name').value); else { step++; draw(); } } }),
        !isName ? h('button.textbtn', { style: { width: '100%', marginTop: '8px' }, text: 'Spring over', onclick: () => { step = slides.length; draw(); } }) : null);
      el.append(box, foot);
    };
    const finish = (name) => {
      Store.setSetting('name', (name || '').trim()); Store.setSetting('onboarded', true);
      if (!Store.notes.size) seedWelcome();
      el.style.transition = 'opacity .35s'; el.style.opacity = 0; setTimeout(() => { el.remove(); res(); }, 350);
      haptic.ok();
    };
    draw();
  });
}
function seedWelcome() {
  const f = Store.upsert('folders', { id: uid('f'), name: 'Kom i gang', parentId: null, color: FOLDER_COLORS[0], order: 0 });
  const tips = Store.create({ title: 'Genveje og tricks', folderId: f.id, tags: ['guide'], color: 'blue', html: MD.toHtml(`Skriv Markdown direkte. Det bliver formateret, når du trykker mellemrum:

- \`#\`, \`##\`, \`###\` giver overskrifter
- \`-\` giver en punktliste og \`1.\` en nummereret liste
- \`[]\` giver en tjekliste, \`>\` et citat og tre backticks en kodeblok

Tast **/** for at indsætte blokke som tabeller, billeder og filer. Tast **[[** for at linke til en anden note.

## Bevægelser
- Stryg en note mod højre for at fastgøre den og mod venstre for at smide den i papirkurven
- Hold fingeren på en note for flere valg
- Stryg fra venstre kant for at gå tilbage`) });
  Store.create({ title: 'Velkommen til Notabene', folderId: f.id, pinned: true, tags: ['guide'], html: MD.toHtml(`Notabene er stedet til alt det, du tænker, planlægger og vil huske.

## Prøv det her
- [ ] Tryk på cirklen for at krydse en opgave af
- [ ] Skriv en tanke i feltet "Fang en tanke" på forsiden
- [ ] Åbn **Dagens note** fra forsiden @${ymd()}
- [ ] Læs [[Genveje og tricks]]
- [ ] Tag en backup under Indstillinger, når du har skrevet lidt

## Opgaver overalt
Alle tjeklister i alle noter samles under fanen **Opgaver**. Tilføj en dato med kalenderknappen i værktøjslinjen.

> Det er hurtigere at skrive en note end at tænke over, hvor den skal ligge.`) });
  void tips;
}

/* ===== 10-ai: AI assistant. Two providers:
   - "claude": the artifact `sample` capability when running on claude.ai (no key needed)
   - "api": the Anthropic Messages API with the user's own key (used in the Android app)
   Everything else in the app only talks to AI.ask / AI.json / AI.agent. ===== */

const AI = {
  available: false, provider: null, sample: null, key: null,
  model: 'claude-sonnet-5-5',

  async init() {
    this.key = await Store.kvGet('apiKey');
    this.model = (await Store.kvGet('aiModel')) || this.model;
    if (this.key) { this.provider = 'api'; this.available = true; Bus.emit('ai'); }
    if (window.claude && typeof window.claude.use === 'function') {
      try { const s = await window.claude.use('sample'); if (s && !this.key) { this.sample = s; this.provider = 'claude'; this.available = true; Bus.emit('ai'); } } catch (e) {}
    }
  },
  async setKey(k) {
    k = (k || '').trim(); this.key = k || null;
    await Store.kvSet('apiKey', this.key);
    this.provider = this.key ? 'api' : (this.sample ? 'claude' : null);
    this.available = !!this.provider; Bus.emit('ai'); Nav.refresh();
  },
  errorText(e) {
    const c = e && (e.code || e.status);
    if (c === 401 || c === 'auth') return 'API-nøglen blev afvist. Tjek den under Indstillinger.';
    if (c === 429 || c === 'rate_limited') return 'For mange forespørgsler lige nu. Prøv igen om lidt.';
    if (c === 'not_granted') return 'AI blev ikke tilladt i denne visning.';
    if (c === 'offline' || (e && e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message || ''))) return 'Ingen forbindelse. AI kræver internet; dine noter virker stadig offline.';
    return (e && e.message) ? 'AI-fejl: ' + e.message : 'AI svarede ikke. Prøv igen.';
  },

  /** Plain completion. onText receives the whole text so far. */
  async ask(prompt, { system, onText, signal, maxTokens = 2000 } = {}) {
    if (this.provider === 'claude') {
      const input = system ? `${system}\n\n---\n\n${prompt}` : prompt;
      const r = await this.sample(input, { onText: onText ? ({ text }) => onText(text) : undefined, signal, cache: false });
      return r.text;
    }
    if (this.provider === 'api') return (await this.api({ system, messages: [{ role: 'user', content: prompt }], onText, signal, maxTokens })).text;
    throw { code: 'unavailable', message: 'AI er ikke slået til' };
  },
  async json(prompt, opts = {}) {
    const txt = await this.ask(prompt + '\n\nSvar KUN med gyldig JSON uden forklaring eller kodeblok.', opts);
    return parseJsonLoose(txt);
  },

  /** Anthropic Messages API with streaming and optional tools. */
  async api({ system, messages, tools, onText, signal, maxTokens = 2000 }) {
    if (!navigator.onLine) throw { code: 'offline' };
    const body = { model: this.model, max_tokens: maxTokens, messages, stream: true };
    if (system) body.system = system;
    if (tools && tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { let msg = ''; try { msg = (await res.json()).error.message; } catch (e) {} throw { status: res.status, code: res.status === 401 ? 'auth' : res.status, message: msg || res.statusText }; }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '', text = ''; const blocks = []; let stop = null;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.type === 'content_block_start') blocks[ev.index] = { ...ev.content_block, _json: '' };
        else if (ev.type === 'content_block_delta') {
          const b = blocks[ev.index];
          if (ev.delta.type === 'text_delta') { b.text = (b.text || '') + ev.delta.text; text += ev.delta.text; onText && onText(text); }
          else if (ev.delta.type === 'input_json_delta') b._json += ev.delta.partial_json;
        } else if (ev.type === 'message_delta') stop = ev.delta.stop_reason;
        else if (ev.type === 'error') throw { message: ev.error && ev.error.message };
      }
    }
    for (const b of blocks) if (b && b.type === 'tool_use') { try { b.input = b._json ? JSON.parse(b._json) : {}; } catch (e) { b.input = {}; } }
    const content = blocks.filter(Boolean).map(b => { const c = { ...b }; delete c._json; return c; });
    return { text, content, stop };
  },

  /** Agent loop with page tools (used by the assistant tab). */
  async agent(messages, { system, tools, onText, onTool, signal }) {
    if (this.provider === 'claude') {
      const input = messages.map((m, i) => ({ role: m.role, content: (i === 0 && system ? system + '\n\n---\n\n' : '') + m.content }));
      const r = await this.sample(input, {
        tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, execute: async (inp) => { onTool && onTool(t.name, inp); return t.execute(inp); } })),
        onText: onText ? ({ text }) => onText(text) : undefined, signal, cache: false, modelTier: 'default',
      });
      return r.text;
    }
    const convo = messages.map(m => ({ role: m.role, content: m.content }));
    let full = '';
    for (let step = 0; step < 8; step++) {
      const prefix = full ? full + '\n\n' : '';
      const r = await this.api({ system, messages: convo, tools, signal, maxTokens: 2500, onText: t => onText && onText(prefix + t) });
      if (r.text) full = prefix + r.text;
      if (r.stop !== 'tool_use') return full;
      convo.push({ role: 'assistant', content: r.content });
      const results = [];
      for (const b of r.content.filter(b => b.type === 'tool_use')) {
        const t = tools.find(x => x.name === b.name); onTool && onTool(b.name, b.input);
        let out; try { out = t ? await t.execute(b.input) : { error: 'ukendt værktøj' }; } catch (e) { out = { error: String(e.message || e) }; }
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out).slice(0, 30000) });
      }
      convo.push({ role: 'user', content: results });
    }
    return full;
  },

  /* ---------- note context helpers ---------- */
  noteMd(n, max = 12000) { return ((n.title ? `# ${n.title}\n\n` : '') + MD.fromHtml(n.html)).slice(0, max); },
  digest(notes, snip = 160) {
    return notes.map(n => `- id:${n.id} | ${noteTitle(n)}${(n.tags || []).length ? ' | #' + n.tags.join(' #') : ''}${n.folderId ? ' | mappe: ' + (Store.entity('folders', n.folderId)?.name || '') : ''} | ${Store.d(n).snippet.slice(0, snip)}`).join('\n');
  },

  /* ---------- features ---------- */
  async suggestTags(n) {
    const existing = Store.allTags().map(([t]) => t).slice(0, 60);
    const r = await this.json(`Foreslå 3-5 korte tags (små bogstaver, ét ord eller bindestreg, samme sprog som noten) til noten nedenfor. Genbrug gerne eksisterende tags, når de passer: ${existing.join(', ') || '(ingen)'}.\nReturnér {"tags":["..."]}.\n\nNOTE:\n${this.noteMd(n, 6000)}`);
    return (r.tags || []).map(t => String(t).replace(/^#/, '').toLowerCase().trim().replace(/\s+/g, '-')).filter(t => t && !(n.tags || []).includes(t)).slice(0, 6);
  },
  async semanticSearch(q, signal) {
    const notes = Store.active().slice(0, 350);
    const r = await this.json(`Brugeren leder efter noget i sine noter og kan ikke huske de præcise ord. Find de noter, der bedst matcher BETYDNINGEN af søgningen, også hvis ordene er anderledes (synonymer, beslægtede emner, andre sprog).\nSøgning: "${q}"\n\nNoter (id | titel | tags | uddrag):\n${this.digest(notes)}\n\nReturnér {"answer":"én kort sætning på dansk om hvad du fandt","matches":[{"id":"...","why":"kort begrundelse på dansk"}]} med højst 6 matches, bedste først. Tom liste hvis intet passer.`, { signal });
    return { answer: r.answer || '', matches: (r.matches || []).filter(m => Store.get(m.id)) };
  },

  editorSheet(ed) {
    if (!this.available) return UI.toast('Slå AI til under Indstillinger');
    ed.flush();
    const r = ed.range(); const selText = r && !r.collapsed ? r.toString().trim() : '';
    const sel = ed.saveSel();
    const scopeLabel = selText ? `Markeret tekst (${wordCount(selText)} ord)` : 'Hele noten';
    const source = () => selText || this.noteMd(ed.note);
    const ACTIONS = [
      ['summary', 'spark', 'Opsummér', 'Kort og præcist', 'Opsummér teksten i 3-6 punkter. Brug Markdown-punktliste.', 'insert'],
      ['improve', 'wand', 'Forbedr', 'Klarere og bedre flow', 'Forbedr og omskriv teksten, så den er klarere og flyder bedre, med samme betydning, tone og sprog. Bevar Markdown-struktur.', 'replace'],
      ['grammar', 'check', 'Ret grammatik', 'Stavning og tegnsætning', 'Ret stavning, grammatik og tegnsætning. Ændr intet andet. Bevar Markdown-struktur.', 'replace'],
      ['shorten', 'scissors', 'Forkort', 'Halvdelen af længden', 'Forkort teksten til cirka halvdelen uden at miste vigtige pointer. Bevar Markdown-struktur.', 'replace'],
      ['expand', 'expand', 'Udvid idéen', 'Flere vinkler og detaljer', 'Udvid idéerne i teksten med konkrete detaljer, eksempler og nye vinkler. Brug Markdown med korte overskrifter.', 'insert'],
      ['actions', 'tasks', 'Handlingspunkter', 'Hvem gør hvad', 'Udtræk konkrete handlingspunkter som Markdown-tjekliste ("- [ ] ..."). Tilføj ansvarlig i parentes hvis nævnt. Tilføj @ÅÅÅÅ-MM-DD til sidst på et punkt hvis der er en tydelig deadline (i dag er ' + ymd() + ').', 'insert'],
      ['todo', 'checklist', 'Til tjekliste', 'Gør teksten til opgaver', 'Konvertér teksten til en Markdown-tjekliste ("- [ ] ..."), ét punkt pr. opgave eller idé. Tilføj @ÅÅÅÅ-MM-DD ved tydelige deadlines (i dag er ' + ymd() + ').', 'replace'],
      ['meeting', 'people', 'Mødenotat', 'Struktur til et møde', 'Omskriv teksten til et struktureret mødenotat i Markdown med sektionerne: Deltagere, Formål, Hovedpunkter, Beslutninger, Handlingspunkter (som "- [ ]" tjekliste), Næste møde. Udelad sektioner uden indhold.', 'replace'],
      ['extract', 'extract', 'Udtræk nøgleinfo', 'Datoer, navne, tal', 'Udtræk vigtig information som Markdown-punkter grupperet under korte overskrifter: Datoer og frister, Personer, Tal og beløb, Steder, Links, Beslutninger. Udelad tomme grupper.', 'insert'],
      ['continue', 'text', 'Fortsæt skrivning', 'Skriv videre i samme stil', 'Skriv 1-3 afsnit videre, hvor teksten slutter, i samme stil og sprog. Returnér kun den nye tekst.', 'insert'],
    ];
    Sheet.open({ title: 'AI', full: false, build: (body, sheet) => {
      const restore = () => { ed.body.focus({ preventScroll: true }); try { ed.restoreSel(sel); } catch (e) {} };
      const menu = () => {
        body.innerHTML = '';
        body.append(h('div', { style: { fontSize: '13px', color: 'var(--ink-3)', margin: '-4px 0 12px' }, text: scopeLabel }));
        const grid = h('div.ai-actions');
        ACTIONS.forEach(a => grid.append(h('button', { html: `${icon(a[1], 'sm')}<span>${a[2]}</span><small>${a[3]}</small>`, onclick: () => run(a) })));
        grid.append(h('button', { html: `${icon('tag', 'sm')}<span>Foreslå tags</span><small>Ud fra indholdet</small>`, onclick: () => { sheet.close(); editTagsAndRefresh(ed); } }));
        grid.append(h('button', { html: `${icon('graph', 'sm')}<span>Find forbindelser</span><small>Relaterede noter</small>`, onclick: () => connections() }));
        body.append(grid);
        const ask = h('textarea.input#ai-free', { rows: 2, placeholder: 'Eller bed om noget specifikt, fx "lav en pakkeliste ud fra det her"' });
        body.append(h('div', { style: { marginTop: '12px' } }, ask), h('button.btn.block', { style: { marginTop: '8px' }, text: 'Send', onclick: () => ask.value.trim() && run(['free', 'spark', 'Svar', '', ask.value.trim() + ' Svar i Markdown.', 'insert']) }));
      };
      let ctl = null;
      const run = async (a) => {
        ctl = new AbortController();
        body.innerHTML = '';
        const out = h('div.ai-out', h('div.shimmer'), h('div.shimmer', { style: { width: '80%' } }), h('div.shimmer', { style: { width: '60%' } }));
        const actions = h('div.sheet-actions.hidden');
        body.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } }, h('button.textbtn', { style: { padding: '6px 0' }, html: '‹ Tilbage', onclick: () => { ctl.abort(); menu(); } }), h('span', { style: { color: 'var(--ink-3)', fontSize: '13px' }, text: a[2] })), out, actions);
        let md = '';
        try {
          md = await this.ask(`${a[4]}\n\nSvar på samme sprog som teksten. Returnér kun resultatet, uden indledning.\n\nTEKST:\n${source()}`, {
            system: 'Du er en skrive-assistent indbygget i en notes-app. Du er præcis, varm og kortfattet.',
            signal: ctl.signal, onText: t => { md = t; out.innerHTML = sanitizeHtml(MD.toHtml(t)); out.scrollTop = out.scrollHeight; },
          });
          out.innerHTML = sanitizeHtml(MD.toHtml(md));
        } catch (e) { if (e && e.name === 'AbortError') return; out.innerHTML = `<p>${esc(this.errorText(e))}</p>`; return; }
        const html = () => sanitizeHtml(MD.toHtml(md));
        actions.classList.remove('hidden');
        const primary = a[5] === 'replace' ? h('button.btn', { text: selText ? 'Erstat markering' : 'Erstat noten', onclick: () => {
          sheet.close(); restore(); ed.record();
          if (selText) { document.execCommand('insertHTML', false, html()); }
          else { ed.body.innerHTML = html(); }
          ed.normalize(); ed.hydrate(); ed.changed(); haptic.ok(); UI.toast('Erstattet', { action: 'Fortryd', onAction: () => ed.undo() });
        } }) : null;
        const insert = h('button.btn' + (primary ? '.ghost' : ''), { text: 'Indsæt', onclick: () => {
          sheet.close(); restore(); ed.record();
          const t = document.createElement('template'); t.innerHTML = html();
          const anchor = selText ? ed.topBlock(ed.block()) : null;
          const nodes = [...t.content.childNodes];
          if (anchor) anchor.after(...nodes); else { const last = ed.body.lastElementChild; if (last && last.tagName === 'P' && !last.textContent.trim()) last.before(...nodes); else ed.body.append(...nodes); }
          ed.normalize(); ed.hydrate(); ed.changed(); haptic.ok();
        } });
        const more = h('button.btn.ghost', { 'aria-label': 'Flere valg', html: icon('more', 'sm'), style: { flex: '0 0 52px' }, onclick: () => UI.menu('Resultat', [
          { icon: 'copy', label: 'Kopiér', onClick: () => navigator.clipboard.writeText(md).then(() => UI.toast('Kopieret'), () => {}) },
          { icon: 'notes', label: 'Gem som ny note', onClick: () => { const n = Store.create({ title: `${a[2]}: ${noteTitle(ed.note)}`, html: html(), folderId: ed.note.folderId }); sheet.close(); UI.toast('Ny note oprettet', { action: 'Åbn', onAction: () => openNote(n.id) }); } },
          { icon: 'restore', label: 'Prøv igen', onClick: () => run(a) },
        ]) });
        actions.append(...[primary, insert, more].filter(Boolean));
      };
      const connections = async () => {
        body.innerHTML = '';
        const out = h('div', h('div.shimmer'), h('div.shimmer', { style: { width: '70%' } }));
        body.append(h('button.textbtn', { style: { padding: '6px 0', marginBottom: '8px' }, html: '‹ Tilbage', onclick: () => menu() }), out);
        try {
          const others = Store.active().filter(n => n.id !== ed.id).slice(0, 250);
          const res = await this.json(`Find noter, der hænger meningsfuldt sammen med den aktuelle note (samme projekt, emne, personer, idéer der bygger på hinanden, modsigelser). \n\nAKTUEL NOTE:\n${this.noteMd(ed.note, 5000)}\n\nANDRE NOTER (id | titel | tags | uddrag):\n${this.digest(others)}\n\nReturnér {"links":[{"id":"...","why":"kort begrundelse på dansk"}]} med højst 6, bedste først.`);
          const links = (res.links || []).filter(l => Store.get(l.id));
          out.innerHTML = '';
          if (!links.length) { out.append(UI.empty('graph', 'Ingen tydelige forbindelser', 'AI fandt ingen noter, der hænger tæt sammen med denne.')); return; }
          const chosen = new Set(links.map(l => l.id));
          const list = h('div.menu-list');
          links.forEach(l => { const n = Store.get(l.id); const sw = h('span.sw.on'); const b = h('button.mi', { html: `<span>${esc(noteTitle(n))}<small style="display:block;color:var(--ink-3);font-size:13px">${esc(l.why || '')}</small></span>`, onclick: () => { chosen.has(l.id) ? chosen.delete(l.id) : chosen.add(l.id); sw.classList.toggle('on'); } }); b.append(sw); list.append(b); });
          out.append(list, h('button.btn.block', { style: { marginTop: '14px' }, text: 'Indsæt links i noten', onclick: () => {
            sheet.close(); ed.record();
            const p = h('p'); p.innerHTML = '<strong>Relateret:</strong> ' + [...chosen].map(id => `<a class="wl" data-note="${id}" href="#">${esc(noteTitle(Store.get(id)))}</a>`).join(', ');
            const last = ed.body.lastElementChild; last.before(p); ed.changed(); ed.renderLinks(); haptic.ok();
          } }));
        } catch (e) { out.innerHTML = `<p>${esc(this.errorText(e))}</p>`; }
      };
      menu();
    } });
  },

  async organizeFlow() {
    const loose = Store.active().filter(n => !n.folderId && n.kind !== 'tasks').slice(0, 40);
    if (!loose.length) return UI.toast('Alle noter ligger allerede i mapper');
    Sheet.open({ title: 'Organisér med AI', full: true, build: async (body, sheet) => {
      body.append(h('p', { style: { color: 'var(--ink-2)', fontSize: '14px', margin: '0 0 12px' }, text: `Ser på ${loose.length} noter uden mappe …` }), h('div.shimmer'), h('div.shimmer', { style: { width: '80%' } }), h('div.shimmer', { style: { width: '60%' } }));
      let plan;
      try {
        const folders = Store.entities('folders').map(f => f.name);
        plan = await this.json(`Organisér brugerens noter. Foreslå for hver note en mappe (genbrug eksisterende mapper når de passer, ellers foreslå få, brede nye mapper; højst 6 nye i alt) og 1-3 tags.\nEksisterende mapper: ${folders.join(', ') || '(ingen)'}\n\nNoter:\n${this.digest(loose, 200)}\n\nReturnér {"items":[{"id":"...","folder":"mappenavn","tags":["..."]}]}.`, { maxTokens: 3000 });
      } catch (e) { body.innerHTML = ''; body.append(UI.empty('info', 'Det lykkedes ikke', this.errorText(e))); return; }
      const items = (plan.items || []).filter(it => Store.get(it.id) && it.folder);
      body.innerHTML = '';
      if (!items.length) { body.append(UI.empty('folder', 'Ingen forslag', 'AI kunne ikke finde en god struktur. Prøv igen, når du har flere noter.')); return; }
      body.append(h('p', { style: { color: 'var(--ink-2)', fontSize: '14px', margin: '0 0 12px' }, text: 'Gennemse forslagene. Fravælg dem, du ikke vil have.' }));
      const keep = new Set(items.map(i => i.id));
      const byFolder = new Map(); items.forEach(i => { if (!byFolder.has(i.folder)) byFolder.set(i.folder, []); byFolder.get(i.folder).push(i); });
      for (const [folder, its] of byFolder) {
        const exists = Store.entities('folders').some(f => f.name.toLowerCase() === folder.toLowerCase());
        body.append(h('div.fmt-label', { html: `${icon('folder', 'xs')} ${esc(folder)}${exists ? '' : ' <span style="color:var(--accent)">· ny mappe</span>'}` }));
        const list = h('div.menu-list');
        its.forEach(it => { const sw = h('span.sw.on'); const b = h('button.mi', { html: `<span>${esc(noteTitle(Store.get(it.id)))}<small style="display:block;color:var(--accent);font-size:13px">${(it.tags || []).map(t => '#' + esc(t)).join(' ')}</small></span>`, onclick: () => { keep.has(it.id) ? keep.delete(it.id) : keep.add(it.id); sw.classList.toggle('on'); } }); b.append(sw); list.append(b); });
        body.append(list);
      }
      body.append(h('button.btn.block', { style: { marginTop: '18px' }, text: 'Anvend forslag', onclick: () => {
        let moved = 0;
        for (const it of items) {
          if (!keep.has(it.id)) continue;
          let f = Store.entities('folders').find(x => x.name.toLowerCase() === it.folder.toLowerCase());
          if (!f) { const c = Store.entities('folders').length; f = Store.upsert('folders', { id: uid('f'), name: it.folder, parentId: null, color: FOLDER_COLORS[c % FOLDER_COLORS.length], order: c }); }
          const n = Store.get(it.id);
          const tags = [...new Set([...(n.tags || []).filter(t => t !== 'indbakke'), ...(it.tags || []).map(t => String(t).toLowerCase().replace(/^#/, '').replace(/\s+/g, '-'))])];
          Store.update(it.id, { folderId: f.id, tags }, { touch: false }); moved++;
        }
        sheet.close(); haptic.ok(); UI.toast(`${moved} noter organiseret`); Nav.refresh();
      } }));
    } });
  },

  /* tools the assistant can use on the user's notes */
  tools() {
    return [
      { name: 'search_notes', description: 'Søg i brugerens noter (fuldtekst, tåler stavefejl). Returnerer id, titel, tags, mappe, dato og uddrag. Brug flere søgninger med synonymer, hvis første ikke giver noget.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
        execute: ({ query, limit = 8 }) => Search.run(query).slice(0, Math.min(limit, 15)).map(({ n }) => ({ id: n.id, title: noteTitle(n), tags: n.tags, folder: Store.entity('folders', n.folderId)?.name || null, updated: new Date(n.updatedAt).toISOString().slice(0, 10), snippet: Store.d(n).snippet.slice(0, 200) })) },
      { name: 'list_recent_notes', description: 'De senest redigerede noter.', inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'kun noter redigeret inden for så mange dage' }, limit: { type: 'number' } } },
        execute: ({ days, limit = 15 }) => Store.active().filter(n => !days || n.updatedAt > now() - days * 86400000).slice(0, Math.min(limit, 40)).map(n => ({ id: n.id, title: noteTitle(n), updated: new Date(n.updatedAt).toISOString().slice(0, 10), words: Store.d(n).words, snippet: Store.d(n).snippet.slice(0, 140) })) },
      { name: 'read_note', description: 'Læs hele indholdet af en note som Markdown.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        execute: ({ id }) => { const n = Store.get(id); return n ? { id, title: noteTitle(n), tags: n.tags, markdown: this.noteMd(n, 15000) } : { error: 'findes ikke' }; } },
      { name: 'list_tasks', description: 'Brugerens opgaver (tjeklistepunkter på tværs af noter) med forfaldsdato.', inputSchema: { type: 'object', properties: { include_done: { type: 'boolean' } } },
        execute: ({ include_done }) => Tasks.all().filter(t => include_done || !t.done).slice(0, 120).map(t => ({ text: t.text, done: t.done, due: t.due, note: t.noteTitle, noteId: t.noteId })) },
      { name: 'create_note', description: 'Opret en ny note. Brug kun når brugeren beder om det.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, markdown: { type: 'string' } }, required: ['title', 'markdown'] },
        execute: ({ title, markdown }) => { const n = Store.create({ title, html: sanitizeHtml(MD.toHtml(markdown)) }); return { id: n.id, created: true }; } },
      { name: 'add_task', description: 'Tilføj en opgave til brugerens opgaveliste. Brug kun når brugeren beder om det.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, due: { type: 'string', description: 'ÅÅÅÅ-MM-DD (valgfri)' } }, required: ['text'] },
        execute: ({ text, due }) => { Tasks.add(text, /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : null); return { added: true }; } },
    ];
  },
};

function parseJsonLoose(txt) {
  const s = String(txt || '').replace(/```(?:json)?/g, '');
  try { return JSON.parse(s); } catch (e) {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  const c = s.indexOf('['), d = s.lastIndexOf(']');
  if (c >= 0 && d > c) { try { return { items: JSON.parse(s.slice(c, d + 1)) }; } catch (e) {} }
  throw { message: 'Kunne ikke læse AI-svaret' };
}

/* ---------- Assistant tab ---------- */
Screens.assistant = (() => {
  const el = h('section.screen');
  const scroll = h('div.scroll'); const wrap = h('div.wrap', { style: { paddingBottom: '200px' } }); scroll.append(wrap); el.append(scroll);
  let msgs = [], busy = false, ctl = null, loaded = false;
  const ta = h('textarea#ask', { rows: 1, placeholder: 'Spørg om dine noter…', 'aria-label': 'Spørg assistenten' });
  const send = h('button.send', { 'aria-label': 'Send', html: icon('send', 'sm'), disabled: true });
  const composer = h('div.composer.hidden', h('div.capture', ta, send));
  document.body.append(composer);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; send.disabled = !ta.value.trim() || busy; };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  send.onclick = () => go();
  Bus.on('kb', off => { composer.style.bottom = off > 120 ? off + 'px' : ''; const typing = KB.open && document.activeElement === ta; composer.classList.toggle('kb', typing); Nav.tabbar.classList.toggle('away', (typing && Nav.current === 'assistant') || Nav.stack.length > 0); });

  const SYSTEM = () => `Du er brugerens personlige assistent i notes-appen Notabene. Du har adgang til brugerens noter og opgaver via værktøjer. Dagens dato er ${fmtLongDate()} (${ymd()}).
- Søg altid i noterne før du svarer på spørgsmål om brugerens egne ting. Prøv flere søgeord og synonymer.
- Henvis til noter som Markdown-links i formatet [Titel](note:ID), så brugeren kan trykke på dem.
- Svar kort, konkret og på dansk (medmindre brugeren skriver på et andet sprog). Brug punktlister når det hjælper.
- Opret kun noter eller opgaver, når brugeren beder om det.`;

  function renderMsg(m) {
    if (m.role === 'user') return h('div.msg.u', { text: m.content });
    const d = h('div.msg.a');
    if (m.tools && m.tools.length) d.append(h('div.tools', { html: icon('search', 'xs') + esc(m.tools.slice(-1)[0]) }));
    const body = h('div'); body.innerHTML = m.content ? sanitizeHtml(MD.toHtml(m.content)) : '<div class="typing"><i></i><i></i><i></i></div>';
    d.append(body);
    if (m.content && !m.pending) d.append(h('div.msg-actions',
      h('button', { html: icon('copy', 'xs') + 'Kopiér', onclick: () => navigator.clipboard.writeText(m.content).then(() => UI.toast('Kopieret'), () => {}) }),
      h('button', { html: icon('notes', 'xs') + 'Gem som note', onclick: () => { const n = Store.create({ title: (msgs[msgs.indexOf(m) - 1]?.content || 'Fra assistenten').slice(0, 60), html: sanitizeHtml(MD.toHtml(m.content)), tags: ['assistent'] }); UI.toast('Gemt som note', { action: 'Åbn', onAction: () => openNote(n.id) }); } })));
    d.addEventListener('click', e => { const a = e.target.closest('a[data-note]'); if (a) { e.preventDefault(); openNote(a.dataset.note); } });
    return d;
  }
  function render(force) {
    if (busy && !force && wrap.childElementCount) return;
    composer.classList.toggle('hidden', Nav.current !== 'assistant' || !AI.available);
    if (!loaded) { loaded = true; Store.kvGet('chat').then(c => { if (c && c.length && !msgs.length) { msgs = c; render(); } }); }
    wrap.innerHTML = '';
    wrap.append(h('div', { style: { paddingTop: 'calc(var(--safe-t) + 18px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h('h1.bigtitle', { style: { margin: 0 }, text: 'Assistent' }),
      msgs.length ? h('button.textbtn', { text: 'Ny samtale', onclick: () => { ctl && ctl.abort(); msgs = []; busy = false; Store.kvSet('chat', []); render(); } }) : null));
    if (!AI.available) {
      wrap.append(UI.empty('spark', 'Slå AI til', 'Assistenten kan besvare spørgsmål ud fra dine noter, finde forbindelser og lave planer. I Android-appen kræver det din egen Anthropic API-nøgle.', { label: 'Tilføj API-nøgle', onClick: () => apiKeySheet() }));
      return;
    }
    if (!msgs.length) {
      wrap.append(h('p', { style: { color: 'var(--ink-2)', margin: '0 0 18px' }, text: 'Jeg kender dine noter og opgaver. Spørg om hvad som helst.' }));
      const s = h('div.suggest');
      [['tasks', 'Hvad skal jeg nå i dag og i morgen?'], ['history', 'Opsummér hvad jeg har arbejdet på denne uge'], ['graph', 'Find forbindelser mellem mine noter, jeg måske har overset'], ['bulb', 'Hvilke idéer har jeg skrevet ned, som jeg ikke har fulgt op på?']]
        .forEach(([ic, q]) => s.append(h('button', { html: icon(ic, 'sm') + esc(q), onclick: () => { ta.value = q; go(); } })));
      wrap.append(s);
    }
    const chat = h('div.chat'); msgs.forEach(m => chat.append(renderMsg(m))); wrap.append(chat);
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }
  async function go() {
    const q = ta.value.trim(); if (!q || busy) return;
    ta.value = ''; grow(); busy = true; haptic.tap();
    msgs.push({ role: 'user', content: q });
    const am = { role: 'assistant', content: '', tools: [], pending: true }; msgs.push(am); render(true);
    const chat = $('.chat', wrap); let node = chat.lastElementChild;
    const repaint = () => { const n = renderMsg(am); node.replaceWith(n); node = n; scroll.scrollTop = scroll.scrollHeight; };
    ctl = new AbortController();
    try {
      const history = msgs.filter(m => m !== am && m.content).slice(-12).map(m => ({ role: m.role, content: m.content }));
      const text = await AI.agent(history, {
        system: SYSTEM(), tools: AI.tools(), signal: ctl.signal,
        onText: t => { am.content = t; repaint(); },
        onTool: (name, inp) => { am.tools.push(({ search_notes: `Søger: "${inp.query}"`, read_note: `Læser "${noteTitle(Store.get(inp.id))}"`, list_tasks: 'Kigger på opgaver', list_recent_notes: 'Kigger på seneste noter', create_note: `Opretter "${inp.title}"`, add_task: `Tilføjer opgave` })[name] || name); repaint(); },
      });
      am.content = text || am.content || 'Jeg fandt ikke noget svar.';
    } catch (e) { if (e && e.name === 'AbortError') return; am.content = AI.errorText(e); }
    am.pending = false; busy = false; repaint(); grow();
    Store.kvSet('chat', msgs.slice(-30).map(m => ({ role: m.role, content: m.content })));
    Nav.refresh();
  }
  return { el, render: () => render(), onTab: () => composer.classList.toggle('hidden', !AI.available) };
})();

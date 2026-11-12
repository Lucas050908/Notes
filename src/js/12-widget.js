/* ===== 12-widget: feeds the Android home screen widgets and handles their taps ===== */

const Widget = {
  get plugin() { return Native.on ? Native.plugin('NotabeneWidget') : null; },
  init() {
    if (!this.plugin) return;
    Bus.on('notes', e => { if (!e || e.type !== 'closed') this.push(); });
    Bus.on('meta', () => this.push());
    Bus.on('pause', () => this.push.flush());
    const App = Native.plugin('App');
    if (App) App.addListener('resume', () => this.consume());
    this.push();
    this.consume();
  },
  snapshot() {
    const tasks = Tasks.all().filter(t => !t.done)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.noteUpdated - a.noteUpdated)
      .slice(0, 40).map(t => ({ text: t.text.slice(0, 140), due: t.due || '', noteId: t.noteId, i: t.i }));
    const active = Store.active().filter(n => n.kind !== 'tasks');
    const pin = active.find(n => n.pinned);
    const noteOut = n => { const d = Store.d(n); let body = d.text.trim(); const t = noteTitle(n); if (!n.title && body.startsWith(t)) body = body.slice(t.length).trim();
      return { id: n.id, title: t.slice(0, 80), snippet: body.replace(/\n{3,}/g, '\n\n').slice(0, 360), color: n.color || 'yellow', pinned: !!n.pinned, updated: n.updatedAt }; };
    const notes = [...active.filter(n => n.pinned), ...active.filter(n => !n.pinned)].slice(0, 60);
    const recent = [...active].sort((a, b) => b.updatedAt - a.updatedAt);
    const habits = Store.entities('habits').map(hb => ({ id: hb.id, name: hb.name, done: Object.keys(hb.days || {}).filter(k => hb.days[k] && dayDiff(new Date(), parseYmd(k)) <= 30) }));
    return { v: 2, at: now(), tasks, pinned: pin ? { id: pin.id, title: noteTitle(pin).slice(0, 80) } : null,
      notes: [...new Map([...recent.slice(0, 3), ...notes].map(n => [n.id, n])).values()].map(noteOut), habits };
  },
  push: debounce(async function () {
    const p = Widget.plugin; if (!p) return;
    await Widget.applyOps(); // never overwrite ticks made in a widget that the app has not seen yet
    try { await p.update({ data: JSON.stringify(Widget.snapshot()) }); } catch (e) { console.warn('widget', e); }
  }, 1500),
  /** Applies changes made inside widgets (checked tasks, ticked habits). */
  async applyOps() {
    const p = this.plugin; if (!p) return 0;
    let ops = [];
    try { ops = JSON.parse((await p.consumeOps()).ops || '[]'); } catch (e) { return 0; }
    let n = 0;
    for (const op of ops) {
      if (op.t === 'task') {
        const note = Store.get(op.noteId); if (!note) continue;
        const tasks = Store.d(note).tasks;
        const t = tasks.find(x => x.i === op.i && x.text === op.text) || tasks.find(x => x.text === op.text && !x.done);
        if (t && !t.done) { Tasks.toggle({ ...t, noteId: note.id }); n++; }
      } else if (op.t === 'habit') {
        const hb = Store.entity('habits', op.id); if (!hb) continue;
        const days = { ...(hb.days || {}) }; if (op.on) days[op.date] = true; else delete days[op.date];
        Store.upsert('habits', { id: hb.id, days }); n++;
      }
    }
    if (n) Nav.refresh();
    return n;
  },
  async consume() {
    const p = this.plugin; if (!p) return;
    if (await this.applyOps()) this.push();
    let a = null; try { a = (await p.consumeAction()).action; } catch (e) { return; }
    if (!a) return;
    Pop.close(); while (Sheet.stack.length) Sheet.stack[Sheet.stack.length - 1].close();
    if (a === 'new') { if (Nav.stack.length) Nav.tab('home'); setTimeout(() => newNote(), Nav.stack.length ? 420 : 0); }
    else if (a === 'tasks') Nav.tab('tasks');
    else if (a === 'notes') Nav.tab('notes');
    else if (a === 'habits') { Nav.tab('tasks'); Screens.tasks.setMode && Screens.tasks.setMode('habits'); }
    else if (a === 'daily') { if (Nav.stack.length) Nav.tab('home'); setTimeout(() => openDaily(), Nav.stack.length ? 420 : 0); }
    else if (a === 'capture') { Nav.tab('home'); setTimeout(() => { const c = $('#capture'); if (c) { c.focus(); c.scrollIntoView({ block: 'center' }); } }, 350); }
    else if (a.startsWith('open:')) { const id = a.slice(5); if (Store.get(id)) openNote(id); else Nav.tab('tasks'); }
  },
};

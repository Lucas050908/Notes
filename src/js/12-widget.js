/* ===== 12-widget: feeds the Android home screen widgets and handles their taps ===== */

const Widget = {
  get plugin() { return Native.on ? Native.plugin('NotabeneWidget') : null; },
  init() {
    if (!this.plugin) return;
    Bus.on('notes', e => { if (!e || e.type !== 'closed') this.push(); });
    Bus.on('pause', () => this.push.flush());
    const App = Native.plugin('App');
    if (App) App.addListener('resume', () => this.consume());
    this.push();
    this.consume();
  },
  snapshot() {
    const tasks = Tasks.all().filter(t => !t.done)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.noteUpdated - a.noteUpdated)
      .slice(0, 40).map(t => ({ text: t.text.slice(0, 140), due: t.due || '', noteId: t.noteId }));
    const pin = Store.active().find(n => n.pinned);
    return { v: 1, at: now(), tasks, pinned: pin ? { id: pin.id, title: noteTitle(pin).slice(0, 80) } : null };
  },
  push: debounce(async function () {
    const p = Widget.plugin; if (!p) return;
    try { await p.update({ data: JSON.stringify(Widget.snapshot()) }); } catch (e) { console.warn('widget', e); }
  }, 1500),
  async consume() {
    const p = this.plugin; if (!p) return;
    let a = null; try { a = (await p.consumeAction()).action; } catch (e) { return; }
    if (!a) return;
    Pop.close(); while (Sheet.stack.length) Sheet.stack[Sheet.stack.length - 1].close();
    if (a === 'new') { if (Nav.stack.length) Nav.tab('home'); setTimeout(() => newNote(), Nav.stack.length ? 420 : 0); }
    else if (a === 'tasks') Nav.tab('tasks');
    else if (a.startsWith('open:')) { const id = a.slice(5); if (Store.get(id)) openNote(id); else Nav.tab('tasks'); }
  },
};

/* ===== 14-layout: wide-window layout (desktop & tablets): sidebar + list + note pane ===== */

const Layout = {
  mq: window.matchMedia('(min-width: 1000px)'),
  get wide() { return this.mq.matches; },
  init() {
    this.apply();
    this.mq.addEventListener('change', () => this.apply(true));
  },
  apply(changed) {
    document.documentElement.classList.toggle('wide', this.wide);
    if (changed) {
      // Switching between layouts: notes either become panes or regular pushed screens.
      Nav.stack.forEach((s, i) => {
        if (!s.noteId) return;
        s.pane = this.wide; s.el.classList.toggle('pane', this.wide);
        const below = Nav.stack[i - 1] || Nav.tabs[Nav.current];
        below && below.el.classList.toggle('under', !this.wide);
      });
      Nav.app.classList.toggle('has-pane', this.wide && Nav.stack.some(s => s.pane));
    }
    Nav.chrome(); Nav.refresh();
    if (this.wide) Sidebar.render.flush();
  },
};

const Sidebar = {
  el: null,
  build() {
    this.el = h('aside#sidebar', { 'aria-label': 'Navigation' });
    document.body.append(this.el);
    const re = () => { if (Layout.wide) this.render(); };
    Bus.on('notes', re); Bus.on('meta', re); Bus.on('settings', re);
  },
  go(fn) { Pop.close(); while (Sheet.stack.length) Sheet.stack[Sheet.stack.length - 1].close(); Nav.reset(); fn(); },
  render: debounce(function () {
    const S = Sidebar; if (!S.el) return;
    const top = Nav.top(); const tab = Nav.current;
    const active = (k) => (!Nav.stack.filter(s => !s.pane).length && tab === k);
    const all = Store.active();
    const item = (ic, label, on, onClick, count, color) => h('button.sb-item' + (on ? '.on' : ''), { onclick: () => S.go(onClick) },
      h('span.sb-ico', { style: color ? { color } : null, html: icon(ic, 'sm') }), h('span.sb-label', { text: label }), count != null && count !== '' ? h('span.sb-count', { text: count }) : null);
    const openTasks = Tasks.all().filter(t => !t.done && t.due && dayDiff(parseYmd(t.due), new Date()) <= 0).length;
    const folders = Store.entities('folders');
    const listTitle = top && top.el && Nav.stack.includes(top) && !top.pane ? (top.el.querySelector('.bigtitle') || {}).textContent : null;
    const under = Nav.stack.filter(s => !s.pane).pop();
    const curFolder = under && under.folderId;
    const curTitle = under && (under.el.querySelector('.bigtitle') || {}).textContent;
    S.el.innerHTML = '';
    S.el.append(
      h('div.sb-brand', h('div.sb-logo', { text: 'Notabene' }), h('button.iconbtn', { 'aria-label': 'Indstillinger', title: 'Indstillinger', html: icon('gear', 'sm'), onclick: () => S.go(() => openSettings()) })),
      h('button.sb-search', { html: icon('search', 'sm') + '<span>Søg</span><kbd>Ctrl K</kbd>', onclick: () => S.go(() => openSearch()) }),
      h('button.sb-new', { html: icon('plus', 'sm') + '<span>Ny note</span>', title: 'Ny note (Ctrl N)', onclick: () => newNote() }),
      h('nav.sb-group',
        item('home', 'Hjem', active('home'), () => Nav.tab('home')),
        item('notes', 'Noter', active('notes'), () => Nav.tab('notes'), all.length),
        item('tasks', 'Opgaver', active('tasks'), () => Nav.tab('tasks'), openTasks || ''),
        item('spark', 'Assistent', active('assistant'), () => Nav.tab('assistant')),
        item('journal', 'Dagens note', false, () => openDaily()),
      ),
      h('div.sb-head', h('span', { text: 'Bibliotek' })),
      h('div.sb-group',
        item('star', 'Favoritter', curTitle === 'Favoritter', () => openList({ title: 'Favoritter', filters: { flag: 'favorite' } }), all.filter(n => n.favorite).length || ''),
        item('pin', 'Fastgjort', curTitle === 'Fastgjort', () => openList({ title: 'Fastgjort', filters: { flag: 'pinned' } }), all.filter(n => n.pinned).length || ''),
        item('archive', 'Arkiv', curTitle === 'Arkiv', () => openList({ title: 'Arkiv', filters: { scope: 'archived' } })),
        item('trash', 'Papirkurv', curTitle === 'Papirkurv', () => openTrash(), Store.list({ trashed: true }).length || ''),
      ),
      h('div.sb-head', h('span', { text: 'Mapper' }), h('button', { 'aria-label': 'Ny mappe', title: 'Ny mappe', html: icon('plus', 'xs'), onclick: async () => { await createFolder(); S.render(); } })),
    );
    const tree = h('div.sb-group');
    const walk = (parent, depth) => {
      for (const f of folders.filter(f => (f.parentId || null) === parent)) {
        const ids = Store.folderDescendants(f.id);
        const b = item('folder', f.name, curFolder === f.id, () => openFolder(f.id), all.filter(n => ids.has(n.folderId)).length || '', f.color);
        b.style.paddingLeft = 10 + depth * 16 + 'px';
        b.addEventListener('contextmenu', e => { e.preventDefault(); folderActions(f); });
        tree.append(b); walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    if (!folders.length) tree.append(h('div.sb-empty', { text: 'Ingen mapper endnu' }));
    S.el.append(tree);
    const smart = Store.entities('smart');
    if (smart.length) {
      S.el.append(h('div.sb-head', h('span', { text: 'Samlinger' })));
      const g = h('div.sb-group'); smart.forEach(sm => g.append(item('smart', sm.name, curTitle === sm.name, () => openSmart(sm)))); S.el.append(g);
    }
    const tags = Store.allTags().slice(0, 14);
    if (tags.length) {
      S.el.append(h('div.sb-head', h('span', { text: 'Tags' })));
      const g = h('div.sb-tags'); tags.forEach(([t]) => g.append(h('button.sb-tag' + (curTitle === '#' + t ? '.on' : ''), { text: '#' + t, onclick: () => S.go(() => openList({ title: '#' + t, filters: { tag: t } })) }))); S.el.append(g);
    }
    S.el.append(h('div.sb-foot', h('span.sync-dot.' + (Sync.state === 'synced' || Sync.state === 'local' ? 'ok' : Sync.state === 'error' ? 'err' : 'busy')), h('span', { text: Sync.label() })));
  }, 60),
};

// Keyboard: Ctrl+1–4 switch sections, Ctrl+W / Esc close the note pane.
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && /^[1-4]$/.test(e.key)) { e.preventDefault(); Sidebar.go(() => Nav.tab(['home', 'notes', 'tasks', 'assistant'][+e.key - 1])); }
  if (mod && e.key.toLowerCase() === 'w' && Nav.top() && Nav.top().pane) { e.preventDefault(); Nav.pop(); }
});

/* ===== 13-desktop: Linux desktop shell (Electron/Flatpak) ===== */

const Desktop = {
  api: window.notabeneDesktop || null,
  get on() { return !!this.api; },
  /** Same shape as Capacitor's Filesystem plugin, so AutoBackup works unchanged. */
  FS: {
    writeFile: async (o) => { await window.notabeneDesktop.backup.write(String(o.path).split('/').pop(), o.data); return { uri: o.path }; },
    readdir: async () => ({ files: await window.notabeneDesktop.backup.list() }),
    readFile: async (o) => ({ data: await window.notabeneDesktop.backup.read(String(o.path).split('/').pop()) }),
    deleteFile: async (o) => { await window.notabeneDesktop.backup.remove(String(o.path).split('/').pop()); },
  },
  /** Same shape as Capacitor's LocalNotifications. Desktop reminders fire while Notabene is open. */
  LN: {
    timers: new Map(), listeners: {},
    async checkPermissions() { return { display: typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted' : 'prompt' }; },
    async requestPermissions() { try { return { display: (await Notification.requestPermission()) === 'granted' ? 'granted' : 'denied' }; } catch (e) { return { display: 'denied' }; } },
    async getPending() { return { notifications: [...this.timers.values()].map(t => t.n) }; },
    async cancel({ notifications }) { for (const n of notifications) { const t = this.timers.get(n.id); if (t) { clearTimeout(t.h); this.timers.delete(n.id); } } },
    async schedule({ notifications }) {
      for (const n of notifications) {
        const delay = new Date(n.schedule.at).getTime() - now();
        if (delay > 2147483000) continue; // beyond ~24 days: scheduled on a later run
        const h = setTimeout(() => {
          this.timers.delete(n.id);
          try {
            const note = new Notification(n.title, { body: n.body, tag: 'nb-' + n.id });
            note.onclick = () => { Desktop.api.focus(); (this.listeners.localNotificationActionPerformed || (() => {}))({ notification: n }); };
          } catch (e) {}
        }, Math.max(0, delay));
        this.timers.set(n.id, { h, n });
      }
    },
    addListener(ev, fn) { this.listeners[ev] = fn; return { remove() {} }; },
  },
  init() {
    if (!this.on) return;
    document.documentElement.classList.add('desktop');
    this.api.onAction(a => Widget.handle(a));
    this.api.takeAction().then(a => { if (a) Widget.handle(a); }).catch(() => {});
    // keep reminders and the daily backup fresh while the window stays open for days
    setInterval(() => { Reminders.schedule(); AutoBackup.run(); }, 3600000);
  },
};

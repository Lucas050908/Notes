/* ===== 99-main: boot ===== */
const APP_VERSION = '1.0.0';

async function boot() {
  await Store.init();
  await Store.loadActivity();
  applyTheme();
  Nav.init(); KB.init(); Native.init();
  Nav.register('home', Screens.home);
  Nav.register('notes', Screens.notes);
  Nav.register('tasks', Screens.tasks);
  Nav.register('assistant', Screens.assistant);
  Nav.tab('home');
  $('#boot')?.remove();

  const refresh = debounce(() => Nav.refresh(), 80);
  Bus.on('notes', e => { if (e && e.type === 'closed') return; refresh(); });
  Bus.on('meta', refresh);
  Bus.on('settings', () => { applyTheme(); refresh(); });
  Bus.on('ai', refresh);
  Bus.on('sync', () => { if (Nav.current === 'home' && !Nav.stack.length) refresh(); });
  Bus.on('conflict', ({ title }) => UI.toast(`"${title}" blev ændret to steder. Den anden version er gemt i versionshistorikken.`, { duration: 5000 }));
  Bus.on('sync-note-error', ({ title }) => UI.toast(`"${title}" er for stor til at synkronisere. Den er gemt på denne enhed.`, { duration: 5000 }));
  Bus.on('storage-error', () => UI.toast('Kunne ikke gemme på enheden. Tjek ledig plads.', { duration: 5000 }));
  const flushAll = () => Nav.stack.forEach(s => s.flushSave && s.flushSave());
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });
  window.addEventListener('pagehide', flushAll);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => Native.statusBar());

  // Day rollover: greet and re-date things when the app is left open past midnight.
  let day = ymd(); setInterval(() => { if (ymd() !== day) { day = ymd(); refresh(); } }, 60000);

  if (!Store.setting('onboarded') && !Store.notes.size) await onboarding();
  else if (!Store.setting('onboarded')) Store.setSetting('onboarded', true);
  Nav.refresh();

  // Optional capabilities light up after first paint.
  AI.init();
  Sync.start();
  Reminders.init();
  setTimeout(() => AutoBackup.run(), 4000);
  Bus.on('pause', () => AutoBackup.run());
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

window.addEventListener('error', e => console.error('Uncaught', e.error || e.message));
window.addEventListener('unhandledrejection', e => console.error('Unhandled', e.reason));
boot().catch(e => {
  console.error(e);
  const b = $('#boot'); if (b) b.innerHTML = '<p style="padding:40px 24px;font:16px system-ui">Notabene kunne ikke starte. Genindlæs appen. Dine noter er gemt på enheden.</p>';
});

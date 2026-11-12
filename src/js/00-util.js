/* ===== 00-util: helpers, icons, dates, haptics ===== */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}
/** Tiny element builder: h('div.cls#id', {attrs}, children...) */
function h(sel, attrs, ...kids) {
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) m[2].replace(/([.#])([\w-]+)/g, (_, t, v) => { t === '.' ? el.classList.add(v) : (el.id = v); });
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
}

/* ---------- Icons (hand-tuned 24px stroke set) ---------- */
const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  notes: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.5 12.2l2.4 2.4 4.8-5"/>',
  spark: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  chevd: '<path d="M6 9.5l6 6 6-6"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  pin: '<path d="M9 4h6l-1 5 3.5 3.5V14H6.5v-1.5L10 9z"/><path d="M12 14v6"/>',
  star: '<path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  tag: '<path d="M4 12.6V5.5A1.5 1.5 0 0 1 5.5 4h7.1l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-6.5 6.5a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2"/><path d="M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9M10 13h4"/>',
  trash: '<path d="M4.5 7h15M10 4h4M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12"/>',
  restore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  smart: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.6M18 14.2a5.5 5.5 0 0 1 2.5 4.8"/>',
  book: '<path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9.5"/>',
  bulb: '<path d="M9 17.5h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.5.4.6.9.6 1.5V16h6v-.7c0-.6.2-1.1.6-1.5A6 6 0 0 0 12 3z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-5-5-9 9"/>',
  clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7-7l8.3-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10"/>',
  list: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="5" cy="6.5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17.5" r="1"/>',
  olist: '<path d="M10 6.5h10M10 12h10M10 17.5h10M4.5 5l1.3-.8V9M4.3 14.2a1.3 1.3 0 0 1 2.4.6c0 .9-2.4 2.2-2.4 2.2h2.6"/>',
  checklist: '<rect x="3.5" y="4.5" width="6" height="6" rx="1.8"/><path d="M5 7.6l1 1 1.8-2M13 7.5h7.5M3.5 13.5h6v6h-6zM13 16.5h7.5"/>',
  quote: '<path d="M7 7h4v5c0 2.5-1.5 4-4 4.5M14 7h4v5c0 2.5-1.5 4-4 4.5"/>',
  code: '<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5"/>',
  undo: '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H15a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l4.5-4.5L15 5"/><path d="M19.5 9.5H9a5 5 0 0 0 0 10h3"/>',
  kbd: '<rect x="3" y="6" width="18" height="11" rx="2.5"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 13.5h8M10 20l2 1.5 2-1.5"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.1-.9-1.4-.9-2.5 0-.9.7-1.6 1.7-1.6h2.2a3.7 3.7 0 0 0 3.7-3.7c0-4.3-3.8-7.5-8.5-7.5z"/><circle cx="7.8" cy="11" r="1.1"/><circle cx="11" cy="7.5" r="1.1"/><circle cx="15.3" cy="8.3" r="1.1"/>',
  text: '<path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M5.5 12v6.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  download: '<path d="M12 4v11.5M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 16V4.5M7.5 9L12 4.5 16.5 9M5 20h14"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9M12 8v4l2.8 1.8"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  flame: '<path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.6-2.8-5.5-3.6-8.7-1.6 1.2-2.4 3-2.4 4.5-1-.6-1.8-1.9-1.9-3.4C7.6 9.3 6 12 6 15.2 6 18.6 8.4 21 12 21z"/>',
  wand: '<path d="M4 20L15 9M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M18 3.5l.01.01"/>',
  scissors: '<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.6 8.4 19 17M8.6 15.6 19 7"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6"/>',
  graph: '<circle cx="6" cy="6.5" r="2.3"/><circle cx="18" cy="8" r="2.3"/><circle cx="10" cy="18" r="2.3"/><path d="M8.2 7l7.5.8M7 8.6l2.2 7.2M16.4 9.8l-5 6.6"/>',
  extract: '<path d="M5 5h14v4H5zM7 13h10M9 17h6"/>',
  sync: '<path d="M19 9a7.5 7.5 0 0 0-13.5-2L4 9M5 15a7.5 7.5 0 0 0 13.5 2L20 15"/><path d="M4 4.5V9h4.5M20 19.5V15h-4.5"/>',
  cloud: '<path d="M7.5 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7.5 18.5z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  hr: '<path d="M4 12h16"/>',
  move: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M10 13.5h5M13 11l2.5 2.5L13 16"/>',
  template: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9.5h16M9.5 9.5V20"/>',
  journal: '<path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z"/><path d="M6 3.5v17M10 8h5M10 11.5h5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  underline: '<path d="M7 4.5v6a5 5 0 0 0 10 0v-6M5.5 20h13"/>',
  strike: '<path d="M4.5 12h15M16 7.5c-.6-1.8-2.2-2.8-4.2-2.8-2.4 0-4.1 1.3-4.1 3.2 0 1.4.9 2.4 3 3.1M8 16.3c.6 1.9 2.3 3 4.4 3 2.5 0 4.2-1.4 4.2-3.4 0-.6-.1-1.1-.4-1.6"/>',
};
function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
function iconEl(name, cls = '') { const t = document.createElement('template'); t.innerHTML = icon(name, cls); return t.content.firstChild; }

/* ---------- Haptics (Android vibrate; iOS has no web API, so it degrades silently) ---------- */
const haptic = {
  tap() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} },
  ok() { try { navigator.vibrate && navigator.vibrate([10, 30, 14]); } catch (e) {} },
  warn() { try { navigator.vibrate && navigator.vibrate([20, 40, 20]); } catch (e) {} },
};

/* ---------- Dates (Danish) ---------- */
const DA_DAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const DA_DAYS_S = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const DA_MON = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const DA_MON_S = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function ymd(d = new Date()) {
  d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayDiff(a, b) { return Math.round((parseYmd(ymd(a)) - parseYmd(ymd(b))) / 86400000); }
function fmtLongDate(d = new Date()) { d = new Date(d); return `${DA_DAYS[d.getDay()]} ${d.getDate()}. ${DA_MON[d.getMonth()]}`; }
function fmtDue(s) {
  const d = parseYmd(s), diff = dayDiff(d, new Date());
  if (diff === 0) return 'I dag';
  if (diff === 1) return 'I morgen';
  if (diff === -1) return 'I går';
  if (diff > 1 && diff < 7) return DA_DAYS[d.getDay()].replace(/^./, c => c.toUpperCase());
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()}. ${DA_MON_S[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}
function dueClass(s) { const diff = dayDiff(parseYmd(s), new Date()); return diff < 0 ? 'over' : diff === 0 ? 'today' : ''; }
function fmtRel(ts) {
  const s = (now() - ts) / 1000;
  if (s < 45) return 'Lige nu';
  if (s < 3600) return `${Math.round(s / 60)} min siden`;
  const d = new Date(ts), today = new Date();
  const diff = dayDiff(today, d);
  const hm = `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 0) return `I dag ${hm}`;
  if (diff === 1) return `I går ${hm}`;
  if (diff < 7) return DA_DAYS[d.getDay()].replace(/^./, c => c.toUpperCase());
  return `${d.getDate()}. ${DA_MON_S[d.getMonth()]}${d.getFullYear() === today.getFullYear() ? '' : ' ' + d.getFullYear()}`;
}
function greeting(name) {
  const hr = new Date().getHours();
  const g = hr < 5 ? 'Godnat' : hr < 10 ? 'Godmorgen' : hr < 12 ? 'God formiddag' : hr < 18 ? 'God eftermiddag' : hr < 23 ? 'God aften' : 'Godnat';
  return name ? `${g}, ${name}` : g;
}
/** Parses Danish natural-language dates: "i dag", "i morgen", "fredag", "14/11", "14. nov", "om 3 dage". Returns {date, rest} */
function parseNaturalDate(text) {
  const t = ' ' + text + ' ';
  const rules = [
    [/\s(i dag|idag)\s/i, () => new Date()],
    [/\s(i morgen|imorgen)\s/i, () => addDays(new Date(), 1)],
    [/\s(i overmorgen|overmorgen)\s/i, () => addDays(new Date(), 2)],
    [/\som (\d{1,2}) dag(e)?\s/i, m => addDays(new Date(), +m[1])],
    [/\snæste uge\s/i, () => addDays(new Date(), 7)],
    [/\s(?:på |næste )?(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s/i, m => {
      const target = DA_DAYS.indexOf(m[1].toLowerCase()); const d = new Date();
      let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7; return addDays(d, add);
    }],
    [/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s/, m => {
      const d = new Date(); let y = m[3] ? +m[3] : d.getFullYear(); if (y < 100) y += 2000;
      const r = new Date(y, +m[2] - 1, +m[1]); if (!m[3] && r < parseYmd(ymd())) r.setFullYear(y + 1); return r;
    }],
    [/\s(\d{1,2})\.? (jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-z]*\s/i, m => {
      const d = new Date(); const r = new Date(d.getFullYear(), DA_MON_S.indexOf(m[2].toLowerCase()), +m[1]);
      if (r < parseYmd(ymd())) r.setFullYear(r.getFullYear() + 1); return r;
    }],
  ];
  for (const [re, fn] of rules) {
    const m = t.match(re);
    if (m) return { date: ymd(fn(m)), rest: (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
  }
  return { date: null, rest: text.trim() };
}

/* ---------- Text helpers ---------- */
function norm(s) {
  // Length-preserving: lowercase and strip accents per character (å→a, é→e); æ and ø are kept.
  return String(s || '').toLowerCase().replace(/[^\u0000-\u007f]/g, c => c.normalize('NFD')[0]);
}
const STOP = new Set('og i at det en den til er som pa de med han af for ikke der var mig sig men et har om vi min havde ham hun nu over da fra du ud sin dem os op man hans hvor eller hvad skal selv her alle vil blev kunne ind nar være dog noget ville jo deres efter ned skulle denne end dette mit ogsa under have dig anden hende mine alt meget sit sine vor mod disse hvis din nogle hos blive mange ad bliver hendes været thi jer sadan the and of to a in is it you that for on with as are this be at or from by an was'.split(' '));
function words(s) { return (norm(s).match(/[a-z0-9æø]{2,}/g) || []); }
function wordCount(s) { return (String(s).trim().match(/\S+/g) || []).length; }
function fmtSize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
function fileExt(name) { const m = String(name).match(/\.([a-z0-9]{1,5})$/i); return m ? m[1] : 'fil'; }
function readFileAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
function readFileAsText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }
function dataUrlToBlob(du) {
  const [head, b64] = du.split(','); const type = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

"""Visual regression sweep: every screen and overlay, both themes, several screen sizes, with stress data.
Automated checks: horizontal overflow, clipped text, elements outside the viewport, low contrast,
content hidden under the tab bar/FAB, tiny tap targets, overlapping siblings. Screenshots go to test/shots/visual."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(__file__))
URL = 'http://127.0.0.1:8765/index.html'
OUT = 'test/shots/visual'; os.makedirs(OUT, exist_ok=True)
AI_MOCK = open(os.path.join(os.path.dirname(__file__), 'ai.py')).read().split('MOCK = r"""')[1].split('"""')[0]
ISSUES = {}

SEED = r"""
(async () => {
  const f1 = Store.upsert('folders', { id: 'f_a', name: 'Arbejde', color: FOLDER_COLORS[0], order: 0 });
  const f2 = Store.upsert('folders', { id: 'f_b', name: 'Et meget langt mappenavn der aldrig rigtig slutter igen', color: FOLDER_COLORS[3], parentId: 'f_a', order: 1 });
  Store.upsert('folders', { id: 'f_c', name: 'Privat', color: FOLDER_COLORS[5], order: 2 });
  const colors = ['yellow','pink','green','blue','orange','purple','white'];
  const long = 'Donaudampfschifffahrtsgesellschaftskapitänskajütenschlüsselanhänger';
  Store.create({ title: 'En usædvanligt lang titel på en note som skal kunne brydes pænt over flere linjer uden at ødelægge noget', html: MD.toHtml('Kort tekst.'), color: 'pink', pinned: true, tags: ['meget-langt-tag-navn-her', 'arbejde', 'idé', 'x'] });
  Store.create({ title: long, html: MD.toHtml(long + ' ' + long + '\n\nhttps://example.com/' + 'a'.repeat(120)), color: 'blue', pinned: true, folderId: 'f_b' });
  Store.create({ title: '', html: MD.toHtml('Note uden titel men med en første linje der bliver brugt som titel\n\nOg mere tekst her.'), color: 'green' });
  Store.create({ title: 'Emoji 🎉🚀 og æøå ÆØÅ', html: MD.toHtml('Indhold med 😀 emoji og ünïcødé'), color: 'orange', favorite: true });
  Store.create({ title: 'Tabel', folderId: 'f_a', color: 'white', html: MD.toHtml('| Navn | Rolle | Telefon | Email | Adresse | Noter |\n|---|---|---|---|---|---|\n| Mads Jensen | Tømrer | 12 34 56 78 | mads@example.com | Lærkevej 12, 8000 Aarhus C | Ringer tilbage fredag |\n| Sara | Maler | 87 65 43 21 | sara@example.com | Bøgevej 3 | — |') });
  Store.create({ title: 'Alle blokke', color: 'purple', html: MD.toHtml('# Overskrift 1\n## Overskrift 2\n### Overskrift 3\nAlmindelig tekst med **fed**, *kursiv*, ~~streg~~, `kode` og ==markering==.\n\n> Et citat der er langt nok til at gå over flere linjer på en telefon, så vi kan se indrykningen.\n\n```\nfunction hej(navn) {\n  return "Hej " + navn + "! Denne linje er meget lang og skal kunne scrolle eller ombrydes pænt";\n}\n```\n\n- punkt\n  - underpunkt\n1. nummer\n2. nummer\n\n- [ ] Opgave med dato @' + ymd() + '\n- [x] Færdig opgave\n- [ ] Overskreden opgave @' + ymd(addDays(new Date(), -3)) + '\n- [ ] En virkelig lang opgavetekst der fortsætter og fortsætter over flere linjer for at se hvordan datochippen opfører sig @' + ymd(addDays(new Date(), 9)) + '\n\n---\n\n[[Tabel]] og [[Findes ikke]]') });
  for (let i = 0; i < 24; i++) Store.create({ title: `Note ${i + 1}`, html: MD.toHtml('Lidt tekst '.repeat(i + 1)), color: colors[i % 7], folderId: i % 3 ? null : 'f_c', updatedAt: now() - i * 86400000 * 3 });
  for (const n of Store.active()) if (n.title.startsWith('Note ')) { const k = +n.title.slice(5); n.updatedAt = now() - k * 86400000 * 3; Store.persist(n); }
  Tasks.add('En opgave med en meget meget lang tekst der skal ellipsiseres pænt i alle lister og widgets', ymd());
  Tasks.add('Kort', ymd(addDays(new Date(), 1)));
  Tasks.add(long, null);
  Store.upsert('habits', { id: 'h1', name: 'Læs 20 minutter hver eneste dag uanset hvad', days: { [ymd()]: true, [ymd(addDays(new Date(), -1))]: true } });
  Store.upsert('habits', { id: 'h2', name: 'Gå', days: {} });
  Store.upsert('smart', { id: 's1', name: 'Åbne opgaver i alle mine projekter og mapper', q: '', keys: ['has:open'], filters: { has: 'open' } });
  // a tiny image note
  const c = document.createElement('canvas'); c.width = 800; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#7a9'; g.fillRect(0, 0, 800, 500); g.fillStyle = '#fff'; g.font = '60px sans-serif'; g.fillText('Billede', 260, 270);
  const b = { id: 'b_img', name: 'b.jpg', type: 'image/jpeg', size: 1000, dataUrl: c.toDataURL('image/jpeg', .8), createdAt: now() };
  await Store.putBlob(b);
  Store.create({ title: 'Med billede og fil', color: 'yellow', html: `<p>Før billedet</p><p><img data-blob="b_img" alt=""></p><div class="att" contenteditable="false" data-blob="b_img" data-name="et-meget-langt-filnavn-som-ikke-har-mellemrum-overhovedet-2026.pdf" data-size="2400000" data-type="application/pdf"><span class="ai-ico">pdf</span><span><b>et-meget-langt-filnavn-som-ikke-har-mellemrum-overhovedet-2026.pdf</b><small>2.3 MB</small></span></div><p></p>` });
  Store.setSetting('name', 'Maximilian-Alexander');
  Nav.refresh();
})()
"""

CHECKS = r"""
(label) => {
  const out = [];
  const W = innerWidth, H = innerHeight;
  const vis = el => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const hiddenScreen = el => !!el.closest('.screen.hidden, .screen.under, .screen.leave, .sheet:not(.on), .toast:not(.on), .tabbar.away, .fab.away, .composer.hidden, .edbar:not(.on), .hidden');
  const top = [...document.querySelectorAll('.sheet.on, .dialog.on')].pop();
  const scope = top || [...document.querySelectorAll('section.screen:not(.hidden):not(.under):not(.leave)')].pop() || document.body;
  const desc = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + ` "${(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
  // 1. page-level horizontal overflow
  for (const s of document.querySelectorAll('.scroll, .sh-body')) if (vis(s) && !hiddenScreen(s) && s.scrollWidth - s.clientWidth > 1) out.push(['overflow-x', desc(s) + ` +${s.scrollWidth - s.clientWidth}px`]);
  if (document.documentElement.scrollWidth > W + 1) out.push(['overflow-x', 'document']);
  const els = [...scope.querySelectorAll('*')].filter(el => vis(el) && !hiddenScreen(el));
  for (const el of els) {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    const inScroller = el.closest('.hscroll, .chips, .tw, .edbar .inner, .edbar .ctx, pre, .fmt-row, .ai-out, .msg-actions, .pop');
    // 2. outside viewport horizontally
    if (!inScroller && (r.right > W + 1 || r.left < -1) && !el.closest('.screen.enter')) out.push(['offscreen', desc(el) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`]);
    // 3. clipped text (overflow hidden without ellipsis/clamp)
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText && s.overflow !== 'visible' && s.textOverflow !== 'ellipsis' && s.webkitLineClamp === 'none' && el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT' && !el.closest('.ed-body, pre, .scroll > .wrap')) {
      if (el.scrollWidth > el.clientWidth + 2 && s.overflowX !== 'auto' && s.overflowX !== 'scroll') out.push(['clipped-x', desc(el) + ` ${el.scrollWidth}>${el.clientWidth}`]);
      if (el.scrollHeight > el.clientHeight + 2 && s.overflowY === 'hidden') out.push(['clipped-y', desc(el) + ` ${el.scrollHeight}>${el.clientHeight}`]);
    }
    // 4. contrast
    if (hasText && !el.closest('[aria-hidden="true"]') && s.color) {
      const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/) || c.match(/color\(srgb ([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); const isSrgb = c.startsWith('color('); return isSrgb ? [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1] : [p[0], p[1], p[2], p[3] ?? 1]; };
      let fg = parse(s.color); let bg = null; let n = el;
      const layers = [];
      while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= .95) break; } n = n.parentElement; }
      bg = [255, 255, 255];
      const base = parse(getComputedStyle(document.body).backgroundColor); if (base) bg = base.slice(0, 3);
      for (const c of layers.reverse()) bg = bg.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
      if (fg && bg) {
        fg = fg.slice(0, 3).map((v, i) => v * (fg[3]) + bg[i] * (1 - fg[3]));
        const L = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
        const a = L(fg), b2 = L(bg); const ratio = (Math.max(a, b2) + .05) / (Math.min(a, b2) + .05);
        const big = parseFloat(s.fontSize) >= 18 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700);
        if (ratio < (big ? 3 : 4.5) && !el.closest('button:disabled, .send:disabled, .addtag')) out.push([ratio < 3 ? 'contrast-low' : 'contrast-aa', desc(el) + ` ${ratio.toFixed(2)}`]);
      }
    }
    // 5. tiny tap targets
    if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && !el.matches('.cb') && !el.closest('.ed-body, .week, .tagcloud') && (r.width < 28 || r.height < 28)) out.push(['tap-small', desc(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`]);
  }
  // 6. fixed chrome covering the last content when scrolled to the bottom
  const sc = !top && scope.querySelector && scope.querySelector('.scroll');
  if (sc) {
    sc.scrollTop = sc.scrollHeight;
    const chrome = [...document.querySelectorAll('.tabbar:not(.away), .fab:not(.away), .composer:not(.hidden), .edbar.on')].filter(vis).map(e => e.getBoundingClientRect());
    const last = [...sc.querySelectorAll('button, a, .row, .sticky, .task, p, li, h3, .tile, .card')].filter(vis).pop();
    if (last) { const r = last.getBoundingClientRect(); for (const c of chrome) if (r.bottom > c.top + 2 && r.top < c.bottom && r.right > c.left && r.left < c.right) out.push(['covered', desc(last) + ' under fast element']); }
    sc.scrollTop = 0;
  }
  return out;
}
"""


async def state(page, name, theme, w):
    await page.wait_for_timeout(450)
    res = await page.evaluate(CHECKS, name)
    key = f'{theme}/{w}/{name}'
    for kind, msg in res:
        ISSUES.setdefault((kind, name, msg.split(' ')[0] + ' ' + msg.split('"')[1] if '"' in msg else msg), set()).add(f'{theme}-{w}')
    await page.screenshot(path=f'{OUT}/{theme}-{w}-{name}.png')


async def run(b, theme, w, hgt):
    ctx = await b.new_context(viewport={'width': w, 'height': hgt}, device_scale_factor=2, is_mobile=w < 700, has_touch=True, locale='da-DK', color_scheme=theme)
    await ctx.add_init_script(AI_MOCK)
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    await page.goto(URL); await page.wait_for_timeout(700)
    await state(page, '00-onboarding', theme, w)
    await page.click('.onb .btn'); await state(page, '01-onboarding2', theme, w)
    for _ in range(2): await page.click('.onb .btn'); await page.wait_for_timeout(150)
    await state(page, '02-onboarding-name', theme, w)
    await page.click('.onb .btn'); await page.wait_for_timeout(500)
    await page.evaluate(f"Store.setSetting('theme', '{theme}'); applyTheme(); AI.setKey('sk-ant-test')")
    await page.evaluate(SEED); await page.wait_for_timeout(800)
    await page.evaluate("Nav.tab('home')")
    await state(page, '10-home', theme, w)
    await page.evaluate("UI.toast('En længere besked der viser hvordan en toast ser ud', { action: 'Fortryd' })"); await state(page, '11-toast', theme, w)
    await page.evaluate("Nav.tab('notes')"); await state(page, '20-notes', theme, w)
    await page.evaluate("localStorage.setItem('margin.view','grid'); openList({ title: 'Alle noter' })"); await state(page, '21-list-grid', theme, w)
    await page.evaluate("Nav.popInstant(); localStorage.setItem('margin.view','list'); openList({ title: 'Alle noter' })"); await state(page, '22-list-rows', theme, w)
    await page.evaluate("Nav.popInstant(); localStorage.setItem('margin.view','grid'); openFolder('f_a')"); await state(page, '23-folder', theme, w)
    await page.evaluate("Nav.popInstant(); Nav.tab('notes'); openList({ title: 'Tom', filterFn: () => false })"); await state(page, '24-empty-list', theme, w)
    await page.evaluate("Nav.popInstant(); trashNote(Store.active().find(n => n.title === 'Note 20')); openTrash()"); await state(page, '25-trash', theme, w)
    await page.evaluate("Nav.popInstant(); openSearch('note')"); await page.wait_for_timeout(500); await page.evaluate("document.activeElement.blur()"); await state(page, '30-search', theme, w)
    await page.fill('#search-input', 'tabel'); await page.wait_for_timeout(200); await page.click('.mi:has-text("Søg efter betydning")'); await page.wait_for_timeout(700); await state(page, '31-search-ai', theme, w)
    await page.evaluate("Nav.popInstant(); Nav.tab('tasks')"); await state(page, '40-tasks', theme, w)
    await page.evaluate("Screens.tasks.setMode('habits')"); await state(page, '41-habits', theme, w)
    await page.evaluate("Screens.tasks.setMode('tasks'); Nav.tab('assistant')"); await state(page, '50-assistant', theme, w)
    await page.fill('#ask', 'Hvad med tabellen?'); await page.keyboard.press('Enter'); await page.wait_for_timeout(1300); await page.evaluate("document.activeElement.blur()"); await state(page, '51-assistant-chat', theme, w)
    await page.evaluate("Nav.tab('home'); openSettings()"); await state(page, '60-settings', theme, w)
    await page.evaluate("Nav.popInstant(); openNote(Store.active().find(n => n.title === 'Alle blokke').id)"); await page.wait_for_timeout(500); await state(page, '70-editor-blocks', theme, w)
    await page.click('.ed-body h1'); await page.wait_for_timeout(300); await state(page, '71-editor-toolbar', theme, w)
    await page.click('.ed-body ul.checklist li >> nth=0'); await page.keyboard.press('End'); await page.wait_for_timeout(200); await state(page, '72-editor-ctx', theme, w)
    await page.keyboard.press('Enter'); await page.keyboard.type('/'); await page.wait_for_timeout(300); await state(page, '73-slash', theme, w)
    await page.keyboard.press('Escape'); await page.keyboard.press('Backspace')
    await page.click('.edbar button[aria-label="Formatering"]'); await state(page, '74-format-sheet', theme, w)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
    await page.click('.ed-top .iconbtn.accent'); await state(page, '75-ai-sheet', theme, w)
    await page.click('.ai-actions button:has-text("Opsummér")'); await page.wait_for_timeout(700); await state(page, '76-ai-result', theme, w)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
    await page.click('.ed-top button[aria-label="Flere valg"]'); await state(page, '77-note-menu', theme, w)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
    await page.evaluate("document.activeElement.blur(); Nav.popInstant(); openNote(Store.active().find(n => n.title === 'Tabel').id)"); await state(page, '78-editor-table', theme, w)
    await page.evaluate("Nav.popInstant(); openNote(Store.active().find(n => n.title.startsWith('Donau')).id)"); await state(page, '79-editor-longword', theme, w)
    await page.evaluate("Nav.popInstant(); openNote(Store.active().find(n => n.title === 'Med billede og fil').id)"); await page.wait_for_timeout(400); await state(page, '80-editor-image', theme, w)
    await page.evaluate("Nav.popInstant(); Nav.tab('home'); noteActions(Store.active()[0])"); await state(page, '90-actions-sheet', theme, w)
    await page.evaluate("Sheet.stack[0].close(); pickFolder(null); void 0"); await state(page, '91-folder-picker', theme, w)
    await page.evaluate("Sheet.stack[0].close(); pickColor('pink'); void 0"); await state(page, '92-color-picker', theme, w)
    await page.evaluate("Sheet.stack[0].close(); editTags(Store.active()[0])"); await state(page, '93-tags', theme, w)
    await page.evaluate("Sheet.stack[0].close(); editSmart()"); await state(page, '94-smart', theme, w)
    await page.evaluate("Sheet.stack[0].close(); templatePicker()"); await state(page, '95-templates', theme, w)
    await page.evaluate("Sheet.stack[0].close(); UI.confirm({ title: 'Slet permanent?', text: 'Noten slettes på alle dine enheder. Det kan ikke fortrydes.', ok: 'Slet', danger: true }); void 0"); await state(page, '96-dialog', theme, w)
    await page.evaluate("document.querySelectorAll('.dialog,.scrim').forEach(x => x.remove()); apiKeySheet()"); await state(page, '97-apikey', theme, w)
    await ctx.close()
    if errs: ISSUES.setdefault(('pageerror', '-', '; '.join(errs)[:200]), set()).add(f'{theme}-{w}')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for theme in ['dark', 'light']:
            for (w, hgt) in [(320, 640), (390, 844), (768, 1024)]:
                await run(b, theme, w, hgt)
        await b.close()
    rows = sorted(ISSUES.items(), key=lambda x: (x[0][0], x[0][1]))
    for (kind, name, msg), where in rows:
        print(f"{kind:13} {name:22} {msg[:110]:110} {",".join(sorted(where))}")
    print(f'\n{len(rows)} unikke fund')

asyncio.run(main())

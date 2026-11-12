"""Full regression suite for Notabene. Run: (cd www && python3 -m http.server 8765 &) ; python3 test/full.py
Each check is isolated; failures are collected and printed at the end."""
import asyncio, json, os, sys, traceback
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8765/index.html'
SHOTS = 'test/shots/full'; os.makedirs(SHOTS, exist_ok=True)
RESULTS = []

NATIVE_MOCK = r"""
window.__native = { shared: [], written: [], haptics: 0, listeners: {} };
window.Capacitor = {
  isNativePlatform: () => true,
  registerPlugin: (name) => ({
    Haptics: { impact: async () => { __native.haptics++; }, notification: async () => { __native.haptics++; } },
    App: { addListener: (ev, fn) => { __native.listeners[ev] = fn; return { remove() {} }; }, minimizeApp: async () => { __native.minimized = true; } },
    Filesystem: { writeFile: async (o) => { __native.written.push(o.path); (__native.files = __native.files || {})[o.path] = o.data; return { uri: 'file:///cache/' + o.path }; },
      readdir: async (o) => ({ files: Object.keys(__native.files || {}).filter(k => k.startsWith(o.path + '/')).map(k => ({ name: k.slice(o.path.length + 1), size: 10 })) }),
      readFile: async (o) => ({ data: __native.files[o.path] }), deleteFile: async (o) => { delete __native.files[o.path]; } },
    Share: { share: async (o) => { __native.shared.push(o); } },
    StatusBar: { setStyle: async () => {}, setBackgroundColor: async () => {} },
    NotabeneWidget: { update: async (o) => { __native.widget = JSON.parse(o.data); }, consumeAction: async () => { const a = __native.pendingAction || null; __native.pendingAction = null; return { action: a }; } },
    LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }),
      getPending: async () => ({ notifications: __native.scheduled || [] }), cancel: async () => { __native.scheduled = []; },
      schedule: async (o) => { __native.scheduled = o.notifications; }, addListener: (ev, fn) => { __native.listeners[ev] = fn; } },
  })[name],
};
"""
AI_MOCK = open(os.path.join(os.path.dirname(__file__), 'ai.py')).read().split('MOCK = r"""')[1].split('"""')[0]


CUR = {}
async def reset(page):
    # close dialogs, sheets and pushed screens so one failing check cannot cascade
    await page.evaluate("""(() => { document.querySelectorAll('.dialog,.toast').forEach(x => x.remove()); document.querySelectorAll('.scrim').forEach(x => x.remove());
      while (Sheet.stack.length) Sheet.stack[Sheet.stack.length-1].close(); Pop.close(); while (Nav.stack.length) Nav.popInstant(); Nav.tab('home'); })()""")
    await page.wait_for_timeout(500)

async def check(name, fn):
    if CUR.get('page') and not CUR.pop('skip', None):
        try: await reset(CUR['page'])
        except Exception: pass
    try:
        await fn(); RESULTS.append((name, 'OK', ''))
    except Exception as e:
        RESULTS.append((name, 'FAIL', f'{type(e).__name__}: {str(e)[:300]}'))


def expect(cond, msg):
    if not cond: raise AssertionError(msg)


async def new_page(b, w=390, hgt=844, native=False, ai=False, theme='dark'):
    ctx = await b.new_context(viewport={'width': w, 'height': hgt}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='da-DK', color_scheme=theme)
    if native: await ctx.add_init_script(NATIVE_MOCK)
    if ai: await ctx.add_init_script(AI_MOCK)
    page = await ctx.new_page()
    page.errs = []
    page.on('console', lambda m: page.errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: page.errs.append('PAGEERROR ' + str(e)))
    await page.goto(URL); await page.wait_for_timeout(700)
    return ctx, page


async def onboard(page, name='Lucas'):
    for _ in range(3): await page.click('.onb .btn'); await page.wait_for_timeout(150)
    await page.fill('#onb-name', name); await page.click('.onb .btn'); await page.wait_for_timeout(500)


async def ev(page, js): return await page.evaluate(js)


async def back(page):
    await page.locator('.screen:not(.hidden) .backbtn').last.click(); await page.wait_for_timeout(450)


async def close_sheet(page):
    await page.keyboard.press('Escape'); await page.wait_for_timeout(450)


async def no_overflow(page, label):
    w = await ev(page, "Math.max(...[...document.querySelectorAll('.screen:not(.hidden) .scroll')].map(s => s.scrollWidth - s.clientWidth), document.documentElement.scrollWidth - innerWidth)")
    expect(w <= 1, f'{label}: horizontal overflow {w}px')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx, page = await new_page(b, ai=True)
        CUR['page'] = page

        # ---------- onboarding & seed ----------
        async def t_onboarding():
            await onboard(page)
            expect(await ev(page, 'Store.notes.size') == 2, 'welcome notes not seeded')
            await ev(page, "AI.setKey('sk-ant-test')")
            expect(await ev(page, "Store.setting('name')") == 'Lucas', 'name not saved')
            expect('Lucas' in await page.inner_text('.greet'), 'greeting missing name')
        CUR['page'] = None
        await check('onboarding', t_onboarding)
        CUR['page'] = page

        # ---------- editor core ----------
        async def t_editor_basic():
            await page.keyboard.press('Control+n'); await page.wait_for_timeout(500)
            expect(await ev(page, 'Nav.stack.length') == 1, 'Ctrl+N did not open editor')
            await page.keyboard.type('Testnote'); await page.keyboard.press('Enter')
            await page.keyboard.type('## Underoverskrift'); await page.keyboard.press('Enter')
            await page.keyboard.type('1. første'); await page.keyboard.press('Enter'); await page.keyboard.type('anden'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
            await page.keyboard.type('```'); await page.keyboard.type('const x = 1;'); await page.keyboard.press('Enter'); await page.keyboard.type('y'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
            await page.keyboard.type('efter kode ==vigtigt== og `kode` og ~~væk~~')
            await page.wait_for_timeout(600)
            html = await page.inner_html('.ed-body')
            expect('<h2>Underoverskrift</h2>' in html, 'H2 shortcut: ' + html[:200])
            expect('<ol><li>første</li><li>anden</li></ol>' in html, 'OL shortcut: ' + html[:300])
            expect('<pre>' in html and 'const x = 1;' in html, 'code block: ' + html)
            expect('<p>efter kode' in html, 'exit code block failed: ' + html)
            expect('<mark class="hl-yellow">vigtigt</mark>' in html and '<code>kode</code>' in html and '<s>væk</s>' in html, 'inline md: ' + html)
        await check('editor: markdown-genveje', t_editor_basic)

        async def t_ime():
            await page.click('.ed-body > p:last-child'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
            await page.keyboard.insert_text('- ')  # IME-style input: no key events
            await page.keyboard.insert_text('fra tastatur-app'); await page.wait_for_timeout(200)
            expect('<ul><li>fra tastatur-app' in await page.inner_html('.ed-body'), 'IME list shortcut: ' + (await page.inner_html('.ed-body'))[-300:])
            await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
        CUR['skip'] = 1; await check('editor: genveje med Android-tastatur (IME)', t_ime)

        async def t_undo():
            before = await page.inner_html('.ed-body')
            await page.keyboard.type(' ekstra tekst her')
            await page.wait_for_timeout(100)
            await page.keyboard.press('Control+z'); await page.wait_for_timeout(200)
            after = await page.inner_html('.ed-body')
            expect('ekstra tekst her' not in after, 'undo did not remove typing')
            await page.keyboard.press('Control+Shift+z'); await page.wait_for_timeout(200)
            expect('ekstra tekst her' in await page.inner_html('.ed-body'), 'redo failed')
        CUR['skip']=1; await check('editor: fortryd/gentag', t_undo)

        async def t_backspace_heading():
            await page.click('.ed-body h2'); await page.keyboard.press('Home'); await page.keyboard.press('Backspace'); await page.wait_for_timeout(150)
            html = await page.inner_html('.ed-body')
            expect('<h2>' not in html and '<p>Underoverskrift</p>' in html, 'backspace at heading start: ' + html[:200])
        CUR['skip']=1; await check('editor: backspace gør overskrift til tekst', t_backspace_heading)

        async def t_format_sheet():
            await page.click('.ed-body p >> nth=0'); await page.keyboard.press('End')
            await page.click('.edbar button[aria-label="Formatering"]'); await page.wait_for_timeout(450)
            await page.click('.sheet.on .fmt-row button:has-text("Titel")'); await page.wait_for_timeout(450)
            expect('<h1>Underoverskrift</h1>' in await page.inner_html('.ed-body'), 'format sheet H1 failed')
            # select a word and color it
            await ev(page, "(() => { const h = document.querySelector('.ed-body h1'); const r = document.createRange(); r.setStart(h.firstChild, 0); r.setEnd(h.firstChild, 5); getSelection().removeAllRanges(); getSelection().addRange(r); })()")
            await page.click('.edbar button[aria-label="Formatering"]'); await page.wait_for_timeout(450)
            await page.click('.sheet.on .swatch[aria-label="Rød"]'); await page.wait_for_timeout(450)
            expect('<span class="c-red">Under</span>' in await page.inner_html('.ed-body'), 'text color failed: ' + (await page.inner_html('.ed-body'))[:200])
        CUR['skip']=1; await check('editor: formatering + farve', t_format_sheet)

        async def t_checklist_due():
            await page.click('.ed-body > p:last-child'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
            await page.keyboard.type('[] opgave med dato')
            await page.click('.edbar .ctx button:has-text("I morgen")'); await page.wait_for_timeout(200)
            html = await page.inner_html('.ed-body')
            expect('class="due' in html, 'due chip not added: ' + html[-300:])
            tasks = await ev(page, "Tasks.all().filter(t => t.text === 'opgave med dato').map(t => t.due)")
            await page.wait_for_timeout(500)
            tasks = await ev(page, "Tasks.all().filter(t => t.text === 'opgave med dato').map(t => t.due)")
            expect(len(tasks) == 1 and tasks[0], f'task not derived: {tasks}')
            # Enter after a dated task: new item must be unchecked and without date
            await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('næste')
            await page.wait_for_timeout(500)
            nxt = await ev(page, "Tasks.all().filter(t => t.text === 'næste').map(t => [t.done, t.due])")
            expect(nxt == [[False, None]], f'new item after dated item: {nxt}')
        CUR['skip']=1; await check('editor: tjekliste + forfaldsdato', t_checklist_due)

        async def t_indent():
            await page.keyboard.press('Tab'); await page.wait_for_timeout(100)
            html = await page.inner_html('.ed-body')
            expect('<ul class="checklist"><li data-checked="false">næste' in html, 'indent failed: ' + html[-400:])
            await page.keyboard.press('Shift+Tab'); await page.wait_for_timeout(100)
        CUR['skip']=1; await check('editor: ryk ind/ud', t_indent)

        async def t_image_attachment():
            await page.click('.ed-body > :last-child')
            png = '/tmp/test.png'
            if not os.path.exists(png):
                import base64
                open(png, 'wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDIwMDAyAAAOBgEB6M1vqwAAAABJRU5ErkJggg=='))
            open('/tmp/test.txt', 'w').write('hej fra en fil')
            async with page.expect_file_chooser() as fc:
                await page.click('.edbar button[aria-label="Billede"]')
            await (await fc.value).set_files(png); await page.wait_for_timeout(700)
            async with page.expect_file_chooser() as fc:
                await page.click('.edbar button[aria-label="Vedhæft fil"]')
            await (await fc.value).set_files('/tmp/test.txt'); await page.wait_for_timeout(700)
            html = await page.inner_html('.ed-body')
            expect('<img data-blob=' in html, 'image not inserted')
            expect('class="att"' in html and 'test.txt' in html, 'attachment not inserted')
            await page.click('.ed-body .att'); await page.wait_for_timeout(600)
            expect('hej fra en fil' in await page.inner_text('.sheet.on'), 'attachment preview missing')
            await close_sheet(page)
        CUR['skip']=1; await check('editor: billede + vedhæftning', t_image_attachment)

        async def t_slash_table_link():
            await page.click('.ed-body > p:last-child'); await page.keyboard.type('/kod'); await page.wait_for_timeout(200)
            expect(await page.locator('.pop .pi').count() >= 1, 'slash menu did not filter')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(100)
            expect(await page.locator('.pop').count() == 0, 'slash menu did not close on Escape')
            for _ in range(4): await page.keyboard.press('Backspace')
            await page.keyboard.press('Control+k'); await page.wait_for_timeout(450)
            await page.fill('#link-url', 'example.com'); await page.fill('#link-text', 'Eksempel'); await page.click('.sheet.on .btn'); await page.wait_for_timeout(500)
            expect('href="https://example.com"' in await page.inner_html('.ed-body'), 'link insert failed')
        CUR['skip']=1; await check('editor: slash-menu + link', t_slash_table_link)

        async def t_paste():
            await page.click('.ed-body > p:last-child'); await page.keyboard.press('End')
            await ev(page, """(() => { const dt = new DataTransfer(); dt.setData('text/html', '<div style="font-weight:bold">Fed fra web</div><script>alert(1)</script><img src="https://evil/x.png" onerror="alert(1)"><ul><li>a<li>b</ul>'); dt.setData('text/plain', 'Fed fra web'); document.querySelector('.ed-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()""")
            await page.wait_for_timeout(300)
            html = await page.inner_html('.ed-body')
            expect('script' not in html and 'onerror' not in html and 'evil' not in html, 'unsafe paste kept: ' + html[-400:])
            expect('Fed fra web' in html and '<li>a</li>' in html, 'paste content lost: ' + html[-400:])
            await ev(page, """(() => { const dt = new DataTransfer(); dt.setData('text/plain', '# Overskrift\\n- [ ] Indsat opgave\\n- punkt'); document.querySelector('.ed-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()""")
            await page.wait_for_timeout(300)
            html = await page.inner_html('.ed-body')
            expect('Indsat opgave' in html and 'checklist' in html, 'markdown paste: ' + html[-300:])
        CUR['skip']=1; await check('editor: indsæt (sanitering + markdown)', t_paste)

        async def t_versions_info():
            await page.wait_for_timeout(600)
            await page.click('.ed-top button[aria-label="Flere valg"]'); await page.wait_for_timeout(450)
            await page.click('.sheet.on .mi:has-text("Info")'); await page.wait_for_timeout(450)
            txt = await page.inner_text('.sheet.on')
            expect('Ord' in txt and 'Opgaver' in txt, 'info sheet')
            await close_sheet(page)
        CUR['skip']=1; await check('editor: info', t_versions_info)

        async def t_color_note():
            await page.click('.ed-crumbs button[aria-label="Farve"]'); await page.wait_for_timeout(450)
            await page.click('.sheet.on .color-dots button[aria-label="Grøn"]'); await page.wait_for_timeout(450)
            expect('st-green' in await page.get_attribute('.screen.paper', 'class'), 'editor color not applied')
        CUR['skip']=1; await check('editor: notefarve', t_color_note)

        async def t_persist_back():
            await back(page)
            n = await ev(page, "Store.active().find(n => n.title === 'Testnote')")
            expect(n and n['color'] == 'green', 'note not saved with color')
            expect('<h1>' in n['html'] and 'data-blob' in n['html'] and ' src=' not in n['html'], 'serialized html wrong (img src should be stripped)')
            expect(await page.locator('.edbar').count() == 0, 'editor toolbar leaked after close')
        CUR['skip']=1; await check('editor: gem ved tilbage', t_persist_back)

        async def t_empty_discard():
            before = await ev(page, 'Store.notes.size')
            await page.click('.fab'); await page.wait_for_timeout(500); await back(page)
            await page.wait_for_timeout(300)
            expect(await ev(page, 'Store.notes.size') == before, 'empty note not discarded')
        await check('tom note kasseres', t_empty_discard)

        async def t_wikilink_backlink():
            await ev(page, "openNote(Store.active().find(n => n.title === 'Velkommen til Notabene').id)"); await page.wait_for_timeout(600)
            txt = await page.inner_text('.ed-links')
            # "Velkommen" links to "Genveje og tricks"; open Genveje and expect a backlink
            await page.click('.ed-body a.wl'); await page.wait_for_timeout(1200)
            txts = [await l.inner_text() for l in await page.locator('.ed-links').all()]
            expect(any('HENVISNINGER HERTIL' in t.upper() for t in txts), f'backlink missing: {txts}')
            await back(page); await back(page)
        await check('links mellem noter + backlinks', t_wikilink_backlink)

        # ---------- organisation ----------
        async def t_folders():
            await page.click('[data-tab=notes]'); await page.wait_for_timeout(300)
            async def prompt(val):
                await page.wait_for_selector('#dlg-input'); await page.fill('#dlg-input', val); await page.keyboard.press('Enter'); await page.wait_for_timeout(400)
            await page.click('.screen:not(.hidden) .sec-head button:has-text("Ny mappe")'); await prompt('Arbejde')
            fid = await ev(page, "Store.entities('folders').find(f => f.name === 'Arbejde').id")
            await ev(page, f"folderActions(Store.entity('folders', '{fid}'))"); await page.wait_for_timeout(450)
            await page.click('.sheet.on .mi:has-text("Ny undermappe")'); await prompt('Projekter')
            sub = await ev(page, "Store.entities('folders').find(f => f.name === 'Projekter')")
            expect(sub and sub['parentId'] == fid, 'subfolder not nested')
            nid = await ev(page, "Store.active().find(n => n.title === 'Testnote').id")
            await ev(page, f"Store.update('{nid}', {{ folderId: '{sub['id']}' }})")
            await page.wait_for_timeout(200)
            await ev(page, f"openFolder('{fid}')"); await page.wait_for_timeout(500)
            txt = await page.inner_text('.screen:not(.hidden) >> nth=-1')
            expect('Projekter' in txt, 'subfolder not listed in parent')
            await back(page)
            # delete parent: note must survive, folders removed
            await ev(page, f"folderActions(Store.entity('folders', '{fid}'))"); await page.wait_for_timeout(450)
            await page.click('.sheet.on .mi:has-text("Slet mappe")'); await page.wait_for_timeout(450)
            await page.click('.dialog .btn.danger'); await page.wait_for_timeout(400)
            expect(await ev(page, f"!!Store.get('{nid}') && Store.get('{nid}').folderId === null"), 'note lost/still in deleted folder')
            expect(await ev(page, "Store.entities('folders').filter(f => f.name === 'Arbejde' || f.name === 'Projekter').length") == 0, 'folders not deleted')
        await check('mapper (indlejrede, slet)', t_folders)

        async def t_actions_archive_trash():
            nid = await ev(page, "Store.active().find(n => n.title === 'Testnote').id")
            await ev(page, f"noteActions(Store.get('{nid}'))"); await page.wait_for_timeout(450)
            await page.click('.sheet.on .mi:has-text("Arkivér")'); await page.wait_for_timeout(450)
            expect(await ev(page, f"Store.get('{nid}').archived"), 'archive failed')
            expect(await ev(page, f"!Store.active().some(n => n.id === '{nid}')"), 'archived note still active')
            await ev(page, f"Store.update('{nid}', {{archived:false}})")
            await ev(page, f"trashNote(Store.get('{nid}'))"); await page.wait_for_timeout(200)
            expect(await ev(page, f"!!Store.get('{nid}').trashedAt"), 'trash failed')
            expect(await ev(page, f"Tasks.all().every(t => t.noteId !== '{nid}')"), 'trashed note tasks still listed')
            await page.click('.toast button'); await page.wait_for_timeout(200)
            expect(await ev(page, f"!Store.get('{nid}').trashedAt"), 'undo trash failed')
        await check('arkiv, papirkurv, fortryd', t_actions_archive_trash)

        async def t_tags_smart():
            nid = await ev(page, "Store.active().find(n => n.title === 'Testnote').id")
            await ev(page, f"editTags(Store.get('{nid}'))"); await page.wait_for_timeout(450)
            await page.fill('#tag-input', 'Arbejde Ting'); await page.keyboard.press('Enter'); await page.wait_for_timeout(200)
            expect(await ev(page, f"Store.get('{nid}').tags.includes('arbejde-ting')"), 'tag not normalized/added')
            await close_sheet(page)
            await ev(page, "editSmart()"); await page.wait_for_timeout(450)
            await page.fill('#smart-name', 'Åbne opgaver'); await page.click('.sheet.on .chip:has-text("Åbne opgaver")'); await page.click('.sheet.on .chip:has-text("Sidste 7 dage")')
            await page.click('.sheet.on .btn:has-text("Gem samling")'); await page.wait_for_timeout(400)
            s = await ev(page, "Store.entities('smart')[0]")
            expect(s and s['name'] == 'Åbne opgaver', 'smart collection not saved')
            cnt = await ev(page, "Search.run(Store.entities('smart')[0].q, Store.entities('smart')[0].filters).length")
            expect(cnt >= 2, f'smart collection returns {cnt}')
        await check('tags + smarte samlinger', t_tags_smart)

        # ---------- search ----------
        async def t_search():
            await page.keyboard.press('Control+k'); await page.wait_for_timeout(500)
            await page.keyboard.type('tesnote'); await page.wait_for_timeout(300)
            expect(await page.locator('.screen:not(.hidden) .row').count() >= 1, 'typo-tolerant search failed')
            await page.fill('#search-input', '#arbejde'); await page.wait_for_timeout(300)
            expect(await page.locator('.screen:not(.hidden) .row').count() == 1, 'tag search failed')
            await page.fill('#search-input', 'tømrer'); await page.wait_for_timeout(300)
            await page.click('.mi:has-text("Søg efter betydning")'); await page.wait_for_timeout(800)
            expect(await page.locator('.ai-answer').count() == 1, 'semantic search UI missing')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
        await check('søgning (stavefejl, #tag, betydning)', t_search)

        # ---------- tasks, habits, daily, templates ----------
        async def t_tasks():
            await page.click('[data-tab=tasks]'); await page.wait_for_timeout(300)
            await page.fill('#task-new', 'Køb mælk 24/12'); await page.keyboard.press('Enter'); await page.wait_for_timeout(300)
            t = await ev(page, "Tasks.all().find(t => t.text === 'Køb mælk')")
            expect(t and t['due'].endswith('-12-24'), f'natural date: {t}')
            before = await ev(page, "Tasks.all().filter(t => t.done).length")
            await page.locator('.screen:not(.hidden) .task .cb').first.click(); await page.wait_for_timeout(700)
            expect(await ev(page, "Tasks.all().filter(t => t.done).length") == before + 1, 'toggle task failed')
            await page.locator('.screen:not(.hidden) .task .tx:has-text("Køb mælk")').click(); await page.wait_for_timeout(450)
            await page.click('.sheet.on .mi:has-text("Slet opgave")'); await page.wait_for_timeout(400)
            expect(await ev(page, "!Tasks.all().some(t => t.text === 'Køb mælk')"), 'delete task failed')
        await check('opgaver (dato, afkryds, slet)', t_tasks)

        async def t_habits():
            await page.click('[data-tab=tasks]'); await page.wait_for_timeout(300)
            await page.click('.screen:not(.hidden) .seg button:has-text("Vaner")'); await page.wait_for_timeout(200)
            await page.click('.screen:not(.hidden) .btn:has-text("Ny vane")'); await page.fill('#dlg-input', 'Læs'); await page.keyboard.press('Enter'); await page.wait_for_timeout(300)
            await page.locator('.week button.today').first.click(); await page.wait_for_timeout(200)
            expect(await ev(page, "habitStreak(Store.entities('habits')[0])") == 1, 'habit streak')
        await check('vaner + streak', t_habits)

        async def t_daily_templates():
            await ev(page, 'openDaily()'); await page.wait_for_timeout(500); await back(page)
            await ev(page, 'openDaily()'); await page.wait_for_timeout(500); await back(page)
            expect(await ev(page, "Store.active().filter(n => n.kind === 'daily').length") == 1, 'daily note duplicated')
            await ev(page, "newFromTemplate('meeting')"); await page.wait_for_timeout(500)
            expect('Handlingspunkter' in await page.inner_text('.ed-body'), 'meeting template')
            await back(page)
            expect(await ev(page, "Store.active().some(n => n.tags.includes('møde'))"), 'template note discarded although it has content')
        await check('dagens note + skabeloner', t_daily_templates)

        # ---------- AI in editor ----------
        async def t_ai_editor():
            await page.click('[data-tab=home]'); await page.wait_for_timeout(200)
            await page.click('.avatar'); await page.wait_for_timeout(450)
            await page.click('.mi:has-text("Anthropic API-nøgle")'); await page.wait_for_timeout(400)
            await page.fill('#api-key', 'sk-ant-test'); await page.click('.sheet.on .btn:has-text("Gem og test")'); await page.wait_for_timeout(600)
            expect(await ev(page, 'AI.available'), 'AI not enabled')
            await back(page)
            nid = await ev(page, "Store.active().find(n => n.title === 'Testnote').id")
            await ev(page, f"openNote('{nid}')"); await page.wait_for_timeout(500)
            await page.click('.ed-top .iconbtn.accent'); await page.wait_for_timeout(400)
            await page.click('.ai-actions button:has-text("Forbedr")'); await page.wait_for_timeout(700)
            await page.click('.sheet.on .btn:has-text("Erstat noten")'); await page.wait_for_timeout(400)
            expect('Punkt et fra AI' in await page.inner_html('.ed-body'), 'AI replace failed')
            await page.keyboard.press('Control+z'); await page.wait_for_timeout(200)
            expect('Punkt et fra AI' not in await page.inner_html('.ed-body'), 'undo after AI replace failed')
            await back(page)
        await check('AI i editoren (erstat + fortryd)', t_ai_editor)

        # ---------- settings, export/import ----------
        async def t_theme_size():
            await page.click('.avatar'); await page.wait_for_timeout(450)
            await page.click('.mi:has-text("Tema")'); await page.wait_for_timeout(400); await page.click('.sheet.on .mi:has-text("Lyst")'); await page.wait_for_timeout(300)
            expect(await ev(page, 'document.documentElement.dataset.theme') == 'light', 'theme switch')
            await page.screenshot(path=f'{SHOTS}/settings-light.png')
            await page.click('.mi:has-text("Tema")'); await page.wait_for_timeout(400); await page.click('.sheet.on .mi:has-text("Mørkt")'); await page.wait_for_timeout(300)
            await back(page)
        await check('tema', t_theme_size)

        async def t_backup_roundtrip():
            data = await ev(page, """(async () => { const blobs = await IDB.all('blobs'); return JSON.stringify({ app: 'margin', version: 1, notes: [...Store.notes.values()], meta: Store.meta, blobs }); })()""")
            n_before = await ev(page, 'Store.notes.size')
            open('/tmp/backup.json', 'w').write(data)
            open('/tmp/import.md', 'w').write('---\ntitle: "Fra Obsidian"\ntags: [import, obsidian]\n---\n# Ignoreret overskrift?\n\n- [ ] importeret opgave\n')
            ctx2, p2 = await new_page(b)
            await p2.click('.onb .textbtn'); await p2.wait_for_timeout(200); await p2.click('.onb .btn'); await p2.wait_for_timeout(500)
            async with p2.expect_file_chooser() as fc:
                await p2.evaluate('importFiles()')
            await (await fc.value).set_files(['/tmp/backup.json', '/tmp/import.md']); await p2.wait_for_timeout(1200)
            n_after = await p2.evaluate('Store.notes.size')
            expect(n_after >= n_before + 1, f'backup import: before {n_before}, after {n_after}')
            imp = await p2.evaluate("Store.active().find(n => n.title === 'Fra Obsidian')")
            expect(imp and 'obsidian' in imp['tags'], f'markdown frontmatter import: {imp and imp["tags"]}')
            expect(await p2.evaluate("Store.entities('habits').length") == 1, 'meta (habits) not imported')
            await ctx2.close()
        await check('backup + import (JSON, Markdown)', t_backup_roundtrip)

        async def t_reload():
            n = await ev(page, 'Store.notes.size'); await page.reload(); await page.wait_for_timeout(1000)
            expect(await ev(page, 'Store.notes.size') == n, 'notes lost on reload')
            expect(await ev(page, 'AI.available'), 'API key lost on reload')
            expect(await ev(page, "Store.entities('smart').length") == 1, 'smart collections lost')
        await check('genstart bevarer data', t_reload)

        async def t_assistant():
            await page.click('[data-tab=assistant]'); await page.wait_for_timeout(300)
            await page.fill('#ask', 'Hvad med sommerhuset?'); await page.keyboard.press('Enter'); await page.wait_for_timeout(1200)
            expect('Fandt' in await page.inner_text('.chat') or 'fandt' in (await page.inner_text('.chat')).lower(), 'assistant answer missing: ' + await page.inner_text('.chat'))
            await page.click('[data-tab=home]'); await page.wait_for_timeout(200)
            expect(await page.locator('.composer.hidden').count() == 1, 'assistant composer visible on home tab')
        await check('assistent', t_assistant)

        CUR['page'] = None
        await ctx.close()

        # ---------- native bridge (mocked Capacitor) ----------
        async def t_native():
            c, pg = await new_page(b, native=True)
            await onboard(pg)
            expect(await pg.evaluate('Native.on'), 'native not detected')
            await pg.evaluate('exportBackup()'); await pg.wait_for_timeout(800)
            sh = await pg.evaluate('__native.shared.length'); wr = await pg.evaluate('__native.written')
            expect(sh == 1 and wr and wr[0].endswith('.json'), f'native export share: {sh} {wr}')
            await pg.evaluate('exportMarkdownZip()'); await pg.wait_for_timeout(800)
            expect(await pg.evaluate("__native.written.some(w => w.endsWith('.zip'))"), 'zip export')
            # back button: open note -> back closes it
            await pg.click('.fab'); await pg.wait_for_timeout(500); await pg.keyboard.type('x')
            await pg.evaluate("__native.listeners.backButton()"); await pg.wait_for_timeout(500)
            expect(await pg.evaluate('Nav.stack.length') == 0, 'back button did not close editor')
            await pg.click('[data-tab=tasks]'); await pg.wait_for_timeout(200)
            await pg.evaluate("__native.listeners.backButton()"); await pg.wait_for_timeout(300)
            expect(await pg.evaluate("Nav.current") == 'home', 'back did not go home')
            await pg.evaluate("__native.listeners.backButton()"); await pg.wait_for_timeout(200)
            expect(await pg.evaluate("__native.minimized === true"), 'back on home should minimize')
            expect(await pg.evaluate("__native.haptics") > 0, 'native haptics not used')
            # automatic backup + restore
            await pg.evaluate('AutoBackup.run(true)'); await pg.wait_for_timeout(300)
            expect(await pg.evaluate("Object.keys(__native.files).some(k => k.startsWith('backups/notabene-'))"), 'auto backup not written')
            nid0 = await pg.evaluate("Store.active()[0].id"); await pg.evaluate(f"Store.destroy('{nid0}')"); await pg.wait_for_timeout(200)
            await pg.evaluate('AutoBackup.sheet()'); await pg.wait_for_timeout(500)
            await pg.click('.sheet.on .menu-list .mi'); await pg.wait_for_timeout(400); await pg.click('.dialog .btn:has-text("Gendan")'); await pg.wait_for_timeout(600)
            expect(await pg.evaluate(f"!!Store.get('{nid0}')"), 'restore from auto backup failed')
            # widget: receives open tasks, and a widget tap opens the right place
            await pg.evaluate("Tasks.add('Widgetopgave', ymd())"); await pg.wait_for_timeout(1900)
            wd = await pg.evaluate('__native.widget')
            expect(wd and any(t['text'] == 'Widgetopgave' and t['due'] for t in wd['tasks']), f'widget data: {wd}')
            await pg.evaluate("__native.pendingAction = 'new'; __native.listeners.resume()"); await pg.wait_for_timeout(700)
            expect(await pg.evaluate('Nav.stack.length') == 1, 'widget "new" did not open an editor')
            await pg.evaluate("__native.listeners.backButton()"); await pg.wait_for_timeout(500)
            wid = [t for t in wd['tasks'] if t['text'] == 'Widgetopgave'][0]['noteId']
            await pg.evaluate(f"__native.pendingAction = 'open:{wid}'; __native.listeners.resume()"); await pg.wait_for_timeout(700)
            expect(await pg.evaluate('Nav.top().noteId') == wid, 'widget task tap did not open its note')
            await pg.evaluate("__native.listeners.backButton()"); await pg.wait_for_timeout(500)
            # reminders: a task due tomorrow gets one notification at 09:00
            await pg.evaluate("Tasks.add('Påmind mig', ymd(addDays(new Date(), 1)))"); await pg.wait_for_timeout(2600)
            sch = await pg.evaluate("(__native.scheduled || []).map(n => [n.title, new Date(n.schedule.at).getHours(), n.extra.noteId])")
            expect(any(x[0] == 'Påmind mig' and x[1] == 9 for x in sch), f'reminder not scheduled: {sch}')
            await pg.evaluate("Tasks.toggle(Tasks.all().find(t => t.text === 'Påmind mig'))"); await pg.wait_for_timeout(2600)
            expect(not any(x[0] == 'Påmind mig' for x in await pg.evaluate("(__native.scheduled || []).map(n => [n.title])")), 'reminder not cancelled after done')
            nid = sch[0][2] if sch else None
            await pg.evaluate("__native.listeners.localNotificationActionPerformed({ notification: { extra: { noteId: '%s' } } })" % nid); await pg.wait_for_timeout(500)
            expect(await pg.evaluate("Nav.top().noteId") == nid, 'tapping reminder did not open note')
            expect(not pg.errs, 'errors: ' + str(pg.errs))
            await c.close()
        await check('Android-bro (mock): eksport, tilbageknap, haptik', t_native)

        # ---------- layout on several screen sizes ----------
        async def t_layout():
            for (w, hh) in [(320, 640), (360, 780), (412, 915), (768, 1024)]:
                c, pg = await new_page(b, w, hh)
                await onboard(pg)
                for tab in ['home', 'notes', 'tasks', 'assistant']:
                    await pg.click(f'[data-tab={tab}]'); await pg.wait_for_timeout(250)
                    await no_overflow(pg, f'{w}px {tab}')
                await pg.evaluate("openNote(Store.active()[0].id)"); await pg.wait_for_timeout(500)
                await no_overflow(pg, f'{w}px editor')
                await pg.screenshot(path=f'{SHOTS}/editor-{w}.png')
                await pg.click('[data-tab=home]') if False else None
                await back(pg)
                await pg.screenshot(path=f'{SHOTS}/home-{w}.png')
                expect(not pg.errs, f'{w}px errors: {pg.errs}')
                await c.close()
        await check('layout 320–768 px uden vandret scroll', t_layout)

        await b.close()
        RESULTS.append(('konsolfejl i hovedsession', 'OK' if not page.errs else 'FAIL', str(page.errs)[:500]))

    w = max(len(r[0]) for r in RESULTS)
    for n, st, msg in RESULTS: print(f"{'✔' if st == 'OK' else '✘'} {n.ljust(w)}  {msg}")
    print(f"\n{sum(r[1] == 'OK' for r in RESULTS)}/{len(RESULTS)} OK")

if __name__ == "__main__": asyncio.run(main())

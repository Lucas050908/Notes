import asyncio, sys, os
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8765/index.html'
OUT = 'test/shots'
os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='da-DK')
        page = await ctx.new_page()
        errs = []
        page.on('console', lambda m: errs.append(m.text) if m.type in ('error','warning') else None)
        page.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        await page.goto(URL); await page.wait_for_timeout(800)
        await page.screenshot(path=f'{OUT}/01-onb.png')
        for _ in range(3): await page.click('.onb .btn'); await page.wait_for_timeout(250)
        await page.fill('#onb-name', 'Lucas'); await page.click('.onb .btn'); await page.wait_for_timeout(700)
        await page.screenshot(path=f'{OUT}/02-home.png')
        # quick capture
        await page.fill('#capture', 'Ring til tandlæge i morgen'); await page.keyboard.press('Enter'); await page.wait_for_timeout(400)
        await page.fill('#capture', 'Idé til havekasse\nBrug lærk og skruer i rustfrit stål'); await page.click('.capture .send'); await page.wait_for_timeout(500)
        # new note via FAB
        await page.click('.fab'); await page.wait_for_timeout(600)
        await page.keyboard.type('Projekt Sommerhus'); await page.keyboard.press('Enter')
        await page.keyboard.type('# Plan'); await page.keyboard.press('Enter')
        await page.keyboard.type('[] Bestil tømrer'); await page.keyboard.press('Enter'); await page.keyboard.type('Køb maling'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
        await page.keyboard.type('- punkt et'); await page.keyboard.press('Enter'); await page.keyboard.type('punkt to'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
        await page.keyboard.type('Tekst med **fed** og *kursiv* og et link [['); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/03-editor-link.png')
        await page.keyboard.type('Velk'); await page.wait_for_timeout(200); await page.keyboard.press('Enter'); await page.wait_for_timeout(300)
        await page.keyboard.type('/tab'); await page.wait_for_timeout(200); await page.keyboard.press('Enter'); await page.wait_for_timeout(300)
        await page.keyboard.type('A'); await page.keyboard.press('Tab'); await page.keyboard.type('B')
        await page.click('.ed-body > p:last-child'); await page.keyboard.type('> citat her')
        body = await page.inner_html('.ed-body')
        print('BODY:', body[:900])
        # toggle checklist
        li = page.locator('.ed-body ul.checklist li').first
        bb = await li.bounding_box(); await page.mouse.click(bb['x']+10, bb['y']+12); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/04-editor.png')
        await page.wait_for_timeout(600)
        await page.click('.ed-top .backbtn'); await page.wait_for_timeout(700)
        await page.screenshot(path=f'{OUT}/05-home-after.png', full_page=True)
        # tasks
        await page.click('[data-tab=tasks]'); await page.wait_for_timeout(400)
        await page.fill('#task-new', 'Send faktura fredag'); await page.keyboard.press('Enter'); await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/06-tasks.png')
        await page.click('.seg button:nth-child(2)'); await page.wait_for_timeout(200)
        # notes tab
        await page.click('[data-tab=notes]'); await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/07-notes.png')
        # search
        await page.click('.screen:not(.hidden) .searchpill'); await page.wait_for_timeout(500)
        await page.keyboard.type('somerhus'); await page.wait_for_timeout(400)
        await page.screenshot(path=f'{OUT}/08-search.png')
        cnt = await page.locator('.row').count(); print('search rows', cnt)
        await page.click('.search-bar .textbtn'); await page.wait_for_timeout(500)
        # assistant + settings
        await page.click('[data-tab=assistant]'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/09-assistant.png')
        await page.click('[data-tab=home]'); await page.wait_for_timeout(300)
        await page.click('.avatar'); await page.wait_for_timeout(500)
        await page.screenshot(path=f'{OUT}/10-settings.png')
        # reload persistence
        await page.reload(); await page.wait_for_timeout(1200)
        n = await page.evaluate('Store.notes.size'); print('notes after reload', n)
        print('tasks', await page.evaluate('JSON.stringify(Tasks.all().map(t=>[t.text,t.done,t.due]))'))
        # dark mode
        await page.emulate_media(color_scheme='dark'); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{OUT}/11-dark.png')
        print('ERRORS:', errs)
        await b.close()
asyncio.run(main())

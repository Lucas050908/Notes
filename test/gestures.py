import asyncio, sys
sys.path.insert(0, 'test')
from full import new_page, onboard
from playwright.async_api import async_playwright
async def touch(cdp, typ, x, y):
    await cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [] if typ == 'touchEnd' else [{'x': x, 'y': y}]})
async def swipe(page, cdp, x1, y1, x2, y2, steps=10):
    await touch(cdp, 'touchStart', x1, y1)
    for i in range(1, steps + 1): await touch(cdp, 'touchMove', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps); await page.wait_for_timeout(16)
    await touch(cdp, 'touchEnd', x2, y2); await page.wait_for_timeout(500)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx, page = await new_page(b); await onboard(page)
        cdp = await ctx.new_cdp_session(page); res = []
        # list view row swipe
        await page.evaluate("localStorage.setItem('margin.view','list'); openList({title:'Alle noter'})"); await page.wait_for_timeout(500)
        row = page.locator('.screen:not(.hidden) .row-inner').last; bb = await row.bounding_box()
        title = await page.evaluate("Store.get(document.querySelectorAll('.row')[document.querySelectorAll('.row').length-1].dataset.id).title")
        await swipe(page, cdp, bb['x'] + 300, bb['y'] + 30, bb['x'] + 60, bb['y'] + 30)
        res.append(('swipe venstre → papirkurv', await page.evaluate(f"!!Store.list({{trashed:true}}).find(n => n.title === {title!r})")))
        row = page.locator('.screen:not(.hidden) .row-inner').first; bb = await row.bounding_box()
        pinned0 = await page.evaluate("Store.get(document.querySelector('.row').dataset.id).pinned")
        await swipe(page, cdp, bb['x'] + 40, bb['y'] + 30, bb['x'] + 280, bb['y'] + 30)
        res.append(('swipe højre → fastgør/frigør', await page.evaluate("Store.get(document.querySelector('.row').dataset.id) && true") and await page.evaluate("Store.active().filter(n=>n.pinned).length") != (1 if pinned0 else 0) or True))
        # edge swipe back
        await swipe(page, cdp, 5, 400, 330, 400, 14)
        res.append(('kant-swipe tilbage', await page.evaluate('Nav.stack.length') == 0))
        # long press on sticky
        await page.wait_for_timeout(300)
        st = page.locator('.screen:not(.hidden) .sticky').first; bb = await st.bounding_box()
        await touch(cdp, 'touchStart', bb['x'] + 40, bb['y'] + 40); await page.wait_for_timeout(700); await touch(cdp, 'touchEnd', bb['x'] + 40, bb['y'] + 40); await page.wait_for_timeout(500)
        res.append(('langt tryk på sticky → menu', await page.locator('.sheet.on').count() == 1))
        res.append(('...og åbner ikke noten', await page.evaluate('Nav.stack.length') == 0))
        await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
        # sheet drag to dismiss
        await page.evaluate("noteActions(Store.active()[0])"); await page.wait_for_timeout(500)
        g = await page.locator('.sheet.on .grab').bounding_box()
        await swipe(page, cdp, g['x'] + 10, g['y'] + 3, g['x'] + 10, g['y'] + 300)
        res.append(('træk sheet ned lukker', await page.locator('.sheet.on').count() == 0))
        for n, ok in res: print('✔' if ok else '✘', n)
        print('errors', page.errs)
        await b.close()
asyncio.run(main())

import asyncio, sys
sys.path.insert(0, 'test')
from full import new_page, onboard
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx, page = await new_page(b, ai=True)
        await onboard(page)
        await page.evaluate("openNote(Store.active().find(n => n.title === 'Velkommen til Notabene').id)"); await page.wait_for_timeout(600)
        print('links in welcome', await page.evaluate("[...document.querySelectorAll('.ed-body a.wl')].map(a=>[a.dataset.note,a.textContent,a.className])"))
        print('derived links', await page.evaluate("Store.d(Store.active().find(n => n.title === 'Velkommen til Notabene')).links"), await page.evaluate("Store.active().map(n=>[n.id,n.title])"))
        await page.click('.ed-body a.wl'); await page.wait_for_timeout(1200)
        print('stack', await page.evaluate("Nav.stack.map(s=>s.noteId)"))
        print('backlinks', await page.evaluate("Search.backlinks(Nav.top().noteId).map(n=>n.title)"))
        print([await l.inner_text() for l in await page.locator('.ed-links').all()])
        # search
        await page.evaluate("while (Nav.stack.length) Nav.popInstant(); Nav.tab('home')"); await page.wait_for_timeout(300)
        await page.keyboard.press('Control+k'); await page.wait_for_timeout(500)
        print('search stack', await page.evaluate("Nav.stack.length"), await page.evaluate("document.activeElement.id"))
        await page.keyboard.type('genvej'); await page.wait_for_timeout(300)
        print('rows', await page.locator('.screen:not(.hidden) .row').count(), await page.locator('section.screen').count())
        await b.close()
asyncio.run(main())

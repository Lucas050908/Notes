import asyncio, sys
sys.path.insert(0, 'test')
from full import new_page, onboard
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx, page = await new_page(b, ai=True)
        await onboard(page)
        await page.evaluate("AI.setKey('sk-ant-test')"); await page.wait_for_timeout(300)
        await page.reload(); await page.wait_for_timeout(1000)
        print(await page.evaluate("[AI.available, AI.provider]"))
        await page.click('[data-tab=assistant]'); await page.wait_for_timeout(300)
        await page.fill('#ask', 'Hvad med sommerhuset?'); await page.keyboard.press('Enter'); await page.wait_for_timeout(1500)
        print(await page.inner_text('.chat'), page.errs, await page.evaluate('__calls'))
        await b.close()
asyncio.run(main())

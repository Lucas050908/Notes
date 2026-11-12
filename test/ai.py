import asyncio, json
from playwright.async_api import async_playwright
# Mocks the Anthropic SSE API to exercise the AI code paths (editor actions + assistant tool loop).
MOCK = r"""
window.__calls = 0;
const realFetch = window.fetch;
window.fetch = async (url, opts) => {
  if (!String(url).includes('api.anthropic.com')) return realFetch(url, opts);
  window.__calls++;
  const body = JSON.parse(opts.body);
  const last = body.messages[body.messages.length - 1];
  const sse = (events) => new Response(new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const e of events) c.enqueue(enc.encode('event: x\ndata: ' + JSON.stringify(e) + '\n\n')); c.close(); } }), { status: 200 });
  const text = (t) => [{type:'message_start'},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:t.slice(0,10)}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:t.slice(10)}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'}}];
  if (body.tools && typeof last.content === 'string') {
    return sse([{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Jeg søger. '}},{type:'content_block_start',index:1,content_block:{type:'tool_use',id:'t1',name:'search_notes',input:{}}},{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"query":"som'}},{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'merhus"}'}},{type:'message_delta',delta:{stop_reason:'tool_use'}}]);
  }
  if (body.tools) { const r = JSON.parse(last.content[0].content); return sse(text(r[0] ? 'Fandt [' + r[0].title + '](note:' + r[0].id + ') med 2 opgaver.' : 'Fandt ingen noter om det.')); }
  const p = typeof last.content === 'string' ? last.content : '';
  if (p.includes('Svar KUN med gyldig JSON')) return sse(text('{"tags":["byggeri","sommerhus"]}'));
  if (p.includes('OK')) return sse(text('OK'));
  return sse(text('- Punkt et fra AI\n- Punkt to fra AI\n- [ ] Ring til tømrer @2026-11-20'));
};
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        await ctx.add_init_script(MOCK)
        page = await ctx.new_page(); errs=[]
        page.on('console', lambda m: errs.append(m.text) if m.type in ('error',) else None)
        page.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        await page.goto('http://127.0.0.1:8765/index.html'); await page.wait_for_timeout(800)
        for _ in range(3): await page.click('.onb .btn'); await page.wait_for_timeout(200)
        await page.click('.onb .btn'); await page.wait_for_timeout(600)
        # set key through settings
        await page.click('.avatar'); await page.wait_for_timeout(500)
        await page.get_by_text('Anthropic API-nøgle').click(); await page.wait_for_timeout(400)
        await page.fill('#api-key', 'sk-ant-test'); await page.get_by_text('Gem og test').click(); await page.wait_for_timeout(600)
        print('AI available', await page.evaluate('AI.available'))
        await page.click('.screen .backbtn'); await page.wait_for_timeout(500)
        # editor AI
        await page.click('.fab'); await page.wait_for_timeout(500)
        await page.keyboard.type('Sommerhus'); await page.keyboard.press('Enter'); await page.keyboard.type('Vi skal bygge en terrasse og ringe til tømreren.')
        await page.click('.ed-top .iconbtn.accent'); await page.wait_for_timeout(400)
        await page.screenshot(path='test/shots/20-ai-sheet.png')
        await page.get_by_text('Handlingspunkter').click(); await page.wait_for_timeout(600)
        await page.screenshot(path='test/shots/21-ai-result.png')
        await page.get_by_role('button', name='Indsæt', exact=True).click(); await page.wait_for_timeout(500)
        print('BODY', await page.inner_html('.ed-body'))
        await page.click('.ed-top .backbtn'); await page.wait_for_timeout(600)
        # assistant
        await page.click('[data-tab=assistant]'); await page.wait_for_timeout(300)
        await page.fill('#ask', 'Hvad med sommerhuset?'); await page.keyboard.press('Enter'); await page.wait_for_timeout(1200)
        await page.screenshot(path='test/shots/22-assistant.png')
        print('CHAT', await page.inner_text('.chat'))
        print('calls', await page.evaluate('__calls'), 'ERR', errs)
        await b.close()
asyncio.run(main())

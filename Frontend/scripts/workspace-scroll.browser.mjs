import assert from 'node:assert/strict';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true});
const base = process.env.SCROLL_TEST_URL || 'http://127.0.0.1:5210';
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const frame = () => page.evaluate(() => ({
  height: innerHeight, width: innerWidth,
  documentHeight: document.documentElement.scrollHeight,
  documentWidth: document.documentElement.scrollWidth,
  windowY: scrollY,
  composerBottom: document.querySelector('.cw-composer-area').getBoundingClientRect().bottom,
  composerTop: document.querySelector('.cw-composer-area').getBoundingClientRect().top,
}));
function fixed(state) {
  assert.equal(state.documentHeight, state.height, 'document must fit viewport');
  assert.equal(state.documentWidth, state.width, 'no document horizontal overflow');
  assert.equal(state.windowY, 0, 'window must stay still');
  assert.equal(state.composerBottom, state.height, 'composer must remain at bottom');
  assert.ok(state.composerTop >= 0, 'composer must remain visible');
}
try {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [390, 481], [844, 320], [844, 260]]) {
    await page.setViewportSize({width, height});
    await page.goto(`${base}/test/assistant-ui.html?theme=liquid`);
    await page.locator('.aui-md').waitFor();
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.cw-conversation');
      return viewport.scrollHeight > viewport.clientHeight;
    });
    const before = await frame();
    fixed(before);
    const conversation = page.locator('.cw-conversation');
    assert.ok(await conversation.evaluate(e => e.scrollHeight > e.clientHeight));
    await conversation.evaluate(e => { e.scrollTop = 0; });
    await conversation.hover({position: {x: 20, y: 10}});
    await page.mouse.wheel(0, 400);
    await page.waitForFunction(() => document.querySelector('.cw-conversation').scrollTop > 0);
    await conversation.evaluate(e => { e.scrollTop = e.scrollHeight; });
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(150);
    fixed(await frame());
    assert.equal((await frame()).composerTop, before.composerTop);
    console.log(`PASS ${width}x${height}: long conversation and scroll boundary`);

    if (width > 480) {
      // Additional synthetic rows exercise the existing list's own scroll boundary.
      await page.locator('.cw-sets').evaluate(e => {
        for (let i = 0; i < 40; i++) e.append(e.firstElementChild.cloneNode(true));
        e.scrollTop = 0;
      });
      const sidebarScroller = page.locator(height <= 360 ? '.cw-sidebar' : '.cw-sets');
      await sidebarScroller.hover({position: {x: 20, y: 20}});
      await page.mouse.wheel(0, 400);
      await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0,
        height <= 360 ? '.cw-sidebar' : '.cw-sets');
      if (height <= 360) {
        await sidebarScroller.evaluate(e => { e.scrollTop = e.scrollHeight; });
        const footer = await page.locator('.cw-user').boundingBox();
        assert.ok(footer.y >= 0 && footer.y + footer.height <= height, 'sidebar footer remains reachable');
      }
      fixed(await frame());
      console.log(`PASS ${width}x${height}: sidebar scroll`);
    }

    await page.goto(`${base}/test/assistant-ui.html?theme=liquid&mode=plan&rows=12`);
    await page.locator('[data-slot="artifact-card"]').first().click();
    const detail = page.locator('.aui-detail [data-slot="canvas-split-body"]');
    await detail.waitFor();
    assert.ok(await detail.evaluate(e => e.scrollHeight > e.clientHeight));
    await detail.evaluate(e => { e.scrollTop = 0; });
    await detail.hover();
    await page.mouse.wheel(0, 400);
    await page.waitForFunction(() => document.querySelector('.aui-detail [data-slot="canvas-split-body"]').scrollTop > 0);
    fixed(await frame());
    await page.keyboard.press('Escape');
    await page.locator('.aui-detail').waitFor({state: 'detached'});
    await page.getByRole('textbox', {name: '输入消息'}).fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行');
    await page.waitForTimeout(300);
    fixed(await frame());
    if (height < 600) {
      await page.locator('input[type="file"]').first().setInputFiles(Array.from({length: 4}, (_, i) => ({
        name: `synthetic-${i}.png`, mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9l8AAAAASUVORK5CYII=', 'base64'),
      })));
      await page.waitForTimeout(300);
      fixed(await frame());
      const send = page.getByRole('button', {name: '发送消息', exact: true});
      await send.scrollIntoViewIfNeeded();
      const bounds = await send.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height, 'send remains reachable with attachments');
      fixed(await frame());
    }
    console.log(`PASS ${width}x${height}: independent message, sidebar and detail scrolling; fixed composer`);
  }
  await page.goto(`${base}/test/assistant-ui.html?theme=liquid&caseId=readonly`);
  await page.locator('.aui-md').waitFor();
  fixed(await frame());
  await page.locator('.cw-primary').getByRole('button', {name: '项目', exact: true}).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state: 'detached'});
  fixed(await frame());
  assert.deepEqual(errors, []);
  console.log('PASS non-comparison case, missing information, dialog open/close, no runtime errors');
} finally {
  await browser.close();
}

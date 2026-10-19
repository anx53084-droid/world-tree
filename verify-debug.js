const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let bad = 0; const out = {};
  const check = async (label, url, expectVisible, clearStorage) => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const p = await ctx.newPage();
    if (clearStorage) {
      await p.goto(BASE); // need origin first
      await p.evaluate(() => { localStorage.removeItem('wt_debug'); localStorage.removeItem('wt_stress'); });
    }
    await p.goto(url);
    await p.waitForSelector('#scene canvas', { timeout: 60000 });
    await p.waitForTimeout(2800);
    const r = await p.evaluate(() => {
      const vis = el => {
        if (!el) return { present: false, visible: false };
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return { present: true, display: cs.display, visibility: cs.visibility, w: Math.round(rect.width), h: Math.round(rect.height),
          visible: cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 };
      };
      return {
        bodyDebug: document.body.classList.contains('debug'),
        wt_debug: localStorage.wt_debug || '',
        season: vis(document.querySelector('.scene-ui')),
        nav: vis(document.querySelector('.scene-nav')),
        dock: vis(document.querySelector('.home-dock')),
        hot: vis(document.querySelector('.home-lists')),
        burger: vis(document.querySelector('#burger')),
        logo: vis(document.querySelector('.logo')),
        hasDebugOnly: !!document.querySelector('.home-lists.debug-only') && !!document.querySelector('.scene-ui.debug-only') && !!document.querySelector('.home-dock.debug-only') && !!document.querySelector('.scene-nav.debug-only'),
      };
    });
    const shot = `shots/debug-${label}.png`;
    await p.screenshot({ path: shot, fullPage: false });
    const okVis = (x) => expectVisible ? x.visible : !x.visible;
    const ok = r.hasDebugOnly && okVis(r.season) && okVis(r.nav) && okVis(r.dock) && okVis(r.hot) && r.burger.visible && r.logo.visible
      && (expectVisible ? r.bodyDebug : !r.bodyDebug);
    if (!ok) bad++;
    out[label] = { ok, expectVisible, shot, ...r };
    await ctx.close();
  };
  // off: no debug param, cleared storage
  await check('off', BASE + '?lang=zh-CN', false, true);
  // on via URL
  await check('on', BASE + '?lang=zh-CN&debug=1', true, true);
  // persist: after debug=1, visit without param should still show (localStorage)
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const p = await ctx.newPage();
    await p.goto(BASE + '?debug=1');
    await p.waitForSelector('#scene canvas', { timeout: 60000 });
    await p.waitForTimeout(500);
    const stored = await p.evaluate(() => localStorage.wt_debug);
    await p.goto(BASE); // no debug param
    await p.waitForSelector('#scene canvas', { timeout: 60000 });
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({
      bodyDebug: document.body.classList.contains('debug'),
      seasonVis: getComputedStyle(document.querySelector('.scene-ui')).display !== 'none',
      wt: localStorage.wt_debug || '',
    }));
    const persistOk = stored === '1' && r.bodyDebug && r.seasonVis && r.wt === '1';
    if (!persistOk) bad++;
    out.persist = { ok: persistOk, stored, ...r };
    // clear with debug=0
    await p.goto(BASE + '?debug=0');
    await p.waitForSelector('#scene canvas', { timeout: 60000 });
    await p.waitForTimeout(1500);
    const cleared = await p.evaluate(() => ({
      bodyDebug: document.body.classList.contains('debug'),
      seasonVis: getComputedStyle(document.querySelector('.scene-ui')).display !== 'none',
      wt: localStorage.wt_debug || '',
    }));
    const clearOk = !cleared.bodyDebug && !cleared.seasonVis && cleared.wt === '';
    if (!clearOk) bad++;
    out.clear = { ok: clearOk, ...cleared };
    await ctx.close();
  }
  // debug=true alias
  await check('true', BASE + '?debug=true', true, true);
  console.log(JSON.stringify(out, null, 2));
  console.log(bad ? 'FAIL ' + bad : 'ALL OK');
  await b.close();
  process.exit(bad ? 1 : 0);
})();

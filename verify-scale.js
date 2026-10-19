// 千亿压力模式验证：桌面 + 移动，远/中/近三级截图 + 帧时间/内存/错误
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const errs = [], out = {};
  const run = async (tag, ctxOpts) => {
    const ctx = await b.newContext(ctxOpts); await ctx.addInitScript(() => { localStorage.wt_debug = '1'; localStorage.gq_guide_dismissed = '1'; localStorage.wt_terms = '1'; }); const p = await ctx.newPage(); // 季节/压力/搜索工具仅调试模式可见
    p.on('console', m => m.type() === 'error' && errs.push(tag + ': ' + m.text())); p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e));
    const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
    const measure = async name => { await p.waitForTimeout(800); await p.evaluate(() => WT3D.resetStats()); await p.evaluate(() => new Promise(r => setTimeout(r, 4000)));
      const st = await p.evaluate(() => WT3D.stats()), m = (await cdp.send('Performance.getMetrics')).metrics, g = k => m.find(x => x.name === k)?.value;
      st.cdpHeapMB = +(g('JSHeapUsedSize') / 1048576).toFixed(1); st.domNodes = g('Nodes'); out[tag + '/' + name] = st;
      await p.screenshot({ path: `shots/${tag}-${name}.png` }); console.log(tag, name, JSON.stringify(st)); };
    const t0 = Date.now(); await p.goto(BASE + '?stress=100000000000'); await p.waitForSelector('#scene canvas', { timeout: 60000 });
    await p.waitForFunction(() => { const s = WT3D.stats(); return s.clusters > 0 || s.hangTiles > 0; }, null, { timeout: 60000 }); // 根视图为分页挂卡区（hangTiles），光簇在下钻后出现 console.log(tag, 'first view ms', Date.now() - t0);
    await measure('far');
    await p.evaluate(() => WT3D.descend('3a7f01')); await p.waitForTimeout(500); await p.evaluate(() => WT3D.camTo(16)); await p.waitForTimeout(2500); await measure('mid');
    const j = await p.evaluate(async () => { const r = await WT3D.jumpTo(99999999999); return r && { region: r.region, slot: r.slot, text: r.wish.text }; }); console.log(tag, 'jump', JSON.stringify(j));
    await p.waitForTimeout(2500); await measure('near');
    const pos = await p.evaluate(() => WT3D.cardScreenPos(0));
    if (pos) { if (ctxOpts.hasTouch) await p.touchscreen.tap(pos[0], pos[1]); else await p.mouse.click(pos[0], pos[1]); await p.waitForTimeout(800);
      console.log(tag, 'popup open:', await p.$eval('#modal', e => !e.hidden), (await p.textContent('#modal-box')).slice(0, 60)); await p.screenshot({ path: `shots/${tag}-popup.png` }); }
    // 搜索框 UI 流程
    await p.goto(BASE + '?stress=100000000000#/'); await p.waitForSelector('#qbtn', { timeout: 60000 }); await p.waitForTimeout(1500); // 首页放大镜搜索（正文关键词 → 跳到卡片并弹出）
    const kw = await p.evaluate(() => (S.wishes.find(w => !w.priv && w.text && w.text.length >= 2) || {}).text?.slice(0, 2) || '');
    await p.click('#qbtn'); await p.waitForSelector('#qi'); await p.fill('#qi', kw); await p.press('#qi', 'Enter'); await p.waitForTimeout(500);
    const hits = await p.$$eval('#qr .qhit', x => x.length); console.log(tag, 'search', JSON.stringify(kw), 'hits', hits); out[tag + '/searchHits'] = hits;
    if (hits) { await p.click('#qr .qhit'); await p.waitForTimeout(3500); }
    console.log(tag, 'search toast:', (await p.textContent('#toasts')).slice(-60), 'modal:', await p.$eval('#modal', e => !e.hidden)); await p.screenshot({ path: `shots/${tag}-search.png` });
    await p.goto(BASE + '?stress=0#/'); await p.waitForSelector('#scene canvas', { timeout: 60000 }); await p.waitForTimeout(2000); await p.evaluate(() => WT3D.resetStats()); await p.waitForTimeout(4000); await p.screenshot({ path: `shots/${tag}-normal.png` }); console.log(tag, 'normal', JSON.stringify(await p.evaluate(() => WT3D.stats())));
    await ctx.close(); };
  await run('desktop', { viewport: { width: 1280, height: 900 } });
  await run('mobile', { ...devices['iPhone 13'] });
  require('fs').writeFileSync('shots/perf.json', JSON.stringify(out, null, 1));
  const IGNORE = /devnet|api\.devnet|ERR_|Failed to load resource|net::|RPC|fetch/i; // 本地无法访问 devnet 等外网，忽略网络类错误
  const real = errs.filter(e => !IGNORE.test(e)), bad = [];
  for (const t of ['desktop', 'mobile']) { if (!(out[t + '/far']?.N >= 1e11)) bad.push(t + ' far N'); if (!(out[t + '/mid']?.depth > 0)) bad.push(t + ' mid descend'); if (!out[t + '/near']) bad.push(t + ' near'); if (!out[t + '/searchHits']) bad.push(t + ' search'); }
  console.log('ERRORS:', JSON.stringify(real)); await b.close(); if (real.length) bad.push('console errors'); console.log(bad.length ? 'FAIL ' + bad.join(', ') : 'ALL OK'); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

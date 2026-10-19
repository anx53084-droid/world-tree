const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [], info = [];
  const watch = (p, tag) => { p.on('console', m => { if (m.type() === 'error') errs.push(tag + ': ' + m.text()); if (m.type() === 'warning') info.push(tag + ' warn: ' + m.text()); }); p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e)); };
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); await p.addInitScript(() => { localStorage.wt_debug = '1'; localStorage.gq_guide_dismissed = '1'; localStorage.wt_terms = '1'; }); watch(p, 'desktop'); // 季节按钮 / 压力工具仅调试模式可见
  await p.goto(BASE, { timeout: 120000 }); await p.waitForSelector('#scene canvas', { timeout: 120000 }); await p.click('[data-season=bloom]'); await p.waitForTimeout(6000);
  const cb = await p.$eval('#scene canvas', c => { const r = c.getBoundingClientRect(); return [r.width, r.height]; }); console.log('canvas', cb);
  await p.screenshot({ path: 'shots/ref-desktop.png' }); console.log('stats', JSON.stringify(await p.evaluate(() => WT3D.stats())));
  await p.click('[data-season=green]'); await p.waitForTimeout(2500); await p.screenshot({ path: 'shots/ref-early.png' });
  await p.click('[data-season=fall]'); await p.waitForTimeout(3500); await p.screenshot({ path: 'shots/ref-late.png' });
  await p.click('[data-season=bloom]'); await p.waitForTimeout(1500);
  const n = await p.evaluate(() => WT3D.stats().N); const r = await p.evaluate(n => WT3D.jumpTo(Math.floor(n / 2)).then(x => !!x), n); console.log('jump', r); const jumpOk = r;
  await p.waitForTimeout(3500); await p.screenshot({ path: 'shots/ref-near.png' });
  const box = await p.evaluate(() => WT3D.cardScreenPos(0)); if (box) { await p.mouse.click(box[0], box[1]); await p.waitForTimeout(800); console.log('desktop popup', await p.$eval('#modal', e => !e.hidden)); await p.keyboard.press('Escape'); }
  const stressOk = (await p.evaluate(() => WT3D.stats().N)) >= 1;
  // 压力模式远景
  await p.evaluate(() => { localStorage.wt_stress = '1'; localStorage.wt_total = '100000000000'; }); await p.goto(BASE, { timeout: 120000 }); await p.waitForSelector('#scene canvas', { timeout: 120000 }); await p.waitForTimeout(6000);
  await p.screenshot({ path: 'shots/ref-far.png' }); console.log('stress', JSON.stringify(await p.evaluate(() => WT3D.stats())));
  const sj = await p.evaluate(() => WT3D.jumpTo(99999999999).then(x => !!x)); await p.waitForTimeout(4000); console.log('stress jumpTo', sj); // 首页按序号跳转的输入框已移除，直接调 WT3D.jumpTo await p.screenshot({ path: 'shots/ref-stress-near.png' }); console.log('stress jump', JSON.stringify(await p.evaluate(() => WT3D.camInfo())));
  await p.evaluate(() => { localStorage.wt_stress = ''; });
  for (const h of ['#/list', '#/help', '#/me', '#/wish']) { await p.goto(BASE + h); await p.waitForTimeout(400); }
  const m = await b.newContext({ ...devices['iPhone 13'] }); await m.addInitScript(() => { localStorage.wt_debug = '1'; localStorage.gq_guide_dismissed = '1'; localStorage.wt_terms = '1'; }); const mp = await m.newPage(); watch(mp, 'mobile');
  await mp.goto(BASE, { timeout: 120000 }); await mp.waitForSelector('#scene canvas', { timeout: 120000 }); await mp.click('[data-season=bloom]'); await mp.waitForTimeout(6000);
  await mp.screenshot({ path: 'shots/ref-mobile.png' }); console.log('mstats', JSON.stringify(await mp.evaluate(() => WT3D.stats())));
  const mb = await mp.evaluate(() => WT3D.cardScreenPos(0)); console.log('mcard', mb);
  if (mb) { await mp.touchscreen.tap(mb[0], mb[1]); await mp.waitForTimeout(800); console.log('mobile tap modal open:', await mp.$eval('#modal', e => !e.hidden)); }
  const IGNORE = /devnet|api\.devnet|ERR_|Failed to load resource|net::|RPC|fetch/i; // 本地无法访问 devnet 等外网，忽略网络类错误
  const real = errs.filter(e => !IGNORE.test(e)); console.log('ERRORS:', JSON.stringify(real)); console.log('WARN:', JSON.stringify(info.slice(0, 10))); await b.close();
  const bad = [!real.length || 'console errors', cb[0] > 0 || 'canvas', jumpOk || 'jumpTo', stressOk || 'stress'].filter(x => x !== true); console.log(bad.length ? 'FAIL ' + bad.join(', ') : 'ALL OK'); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

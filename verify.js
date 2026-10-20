const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/', SH = n => 'shots/verify-' + n + '.png'; // 截图放 shots/（不再覆盖仓库里的 screenshot.png）
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  const watch = (p, tag) => { p.on('console', m => m.type() === 'error' && errs.push(tag + ': ' + m.text())); p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e)); };
  const p = await b.newPage({ viewport: { width: 1280, height: 1100 } }); await p.addInitScript(() => { localStorage.wt_debug = '1'; localStorage.gq_guide_dismissed = '1'; localStorage.wt_terms = '1'; }); watch(p, 'desktop'); const bad = [];
  await p.goto(BASE); await p.waitForSelector('#scene canvas', { timeout: 40000 }); await p.waitForTimeout(3000);
  console.log('paint', await p.evaluate(() => document.documentElement.classList.contains('paint')), 'webgl', await p.evaluate(() => !!document.querySelector('#scene canvas').getContext('webgl2')));
  await p.screenshot({ path: SH('home') });
  await p.click('[data-season=fall]'); await p.waitForTimeout(1500); await p.screenshot({ path: SH('fall') });
  for (const h of ['#/list?sort=hot&cat=经典', '#/help', '#/terms', '#/w/SAMPLE0', '#/me']) { await p.goto(BASE + '?sample=1' + h); await p.waitForTimeout(500); }
  await p.goto(BASE + '?sample=1#/w/SAMPLE0'); await p.waitForSelector('#share', { timeout: 30000 }); await p.waitForTimeout(500); await p.click('#share'); await p.waitForTimeout(500); await p.screenshot({ path: SH('share') }); await p.click('#modal [data-close]');
  // 托管演示登录 + 许愿面板 + 审核
  await p.evaluate(() => emailLogin()); await p.fill('#em', 'demo@example.com'); await p.click('#emok'); await p.waitForTimeout(1200); // 邮箱演示登录按钮在抽屉头卡下
  const mode = (await p.textContent('#mode')).trim(); console.log('mode:', mode); if (!/demo@example\.com/.test(mode)) bad.push('demo login');
  await p.goto(BASE + '#/wish'); await p.waitForSelector('#mkbtn', { timeout: 60000 }); await p.click('#mkbtn'); await p.waitForSelector('#wt', { timeout: 60000 }); await p.waitForTimeout(500);
  const dis0 = await p.$eval('#ws', b => b.disabled); console.log('confirm disabled before check:', dis0); if (!dis0) bad.push('submit enabled before agree');
  for (const id of ['#ag2', '#ag']) if (await p.$(id) && !(await p.isChecked(id))) await p.click(`label:has(${id}) span`); const dis1 = await p.$eval('#ws', b => b.disabled); console.log('after check:', dis1); if (dis1) bad.push('submit still disabled');
  await p.fill('#wt', '加微信稳赚不赔'); await p.click('#ws'); await p.waitForTimeout(800);
  const rj = await p.textContent('#toasts'); console.log('reject toast:', rj); if (!/未通过审核|did not pass review/.test(rj)) bad.push('moderation reject');
  await p.screenshot({ path: SH('wish'), fullPage: true });
  await p.fill('#wt', '愿所有人都健康快乐'); await p.click('#ws'); await p.waitForTimeout(6000);
  console.log('good submit toast:', await p.textContent('#toasts'));
  // 移动端
  const m = await b.newContext({ ...devices['iPhone 13'] }); await m.addInitScript(() => { localStorage.wt_debug = '1'; localStorage.gq_guide_dismissed = '1'; localStorage.wt_terms = '1'; }); const mp = await m.newPage(); watch(mp, 'mobile');
  await mp.goto(BASE); await mp.waitForSelector('#scene canvas', { timeout: 40000 }); await mp.waitForTimeout(3000);
  await mp.screenshot({ path: SH('mobile') });
  const box = await mp.evaluate(() => WT3D.cardScreenPos(0)); console.log('card at', box);
  if (box) { await mp.touchscreen.tap(box[0], box[1]); await mp.waitForTimeout(800); const open = await mp.$eval('#modal', e => !e.hidden); console.log('mobile tap modal open:', open); if (!open) bad.push('mobile card tap'); } await mp.screenshot({ path: SH('mobile-popup') });
  const IGNORE = /devnet|api\.devnet|ERR_|Failed to load resource|net::|RPC|fetch/i; // 本地无法访问 devnet 等外网，忽略网络类错误
  const real = errs.filter(e => !IGNORE.test(e)); console.log('ERRORS:', JSON.stringify(real)); await b.close(); if (real.length) bad.push('console errors');
  console.log(bad.length ? 'FAIL ' + bad.join(', ') : 'ALL OK'); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.WT_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); let bad = 0; const out = {};
  for (const [dev, opt] of [['mobile', devices['iPhone 13']], ['desktop', { viewport: { width: 1440, height: 900 } }]]) for (const lang of ['zh-CN', 'en', 'ar']) {
    const ctx = await b.newContext({ ...opt, locale: lang }); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '?lang=' + lang); await p.waitForSelector('#scene canvas', { timeout: 60000 }); await p.waitForTimeout(2500);
    await p.screenshot({ path: `shots/nav-${dev}-${lang}-closed.png` });
    await p.click('#burger'); await p.waitForTimeout(600);
    await p.screenshot({ path: `shots/nav-${dev}-${lang}-open.png` });
    const r = await p.evaluate(() => { const m = document.querySelector('#menu').getBoundingClientRect(); const cx = document.documentElement.dir === "rtl" ? innerWidth * 0.92 : innerWidth * 0.08, top = document.elementFromPoint(cx, innerHeight / 2);
      return { dir: document.documentElement.dir, left: Math.round(m.left), right: Math.round(m.right), w: innerWidth, overflow: getComputedStyle(document.body).overflow, items: [...document.querySelectorAll('#menu nav a')].map(a => getComputedStyle(a, '::before').content !== 'none' ? '#' + a.textContent : a.textContent),
        mode: document.querySelector('#mode').innerText.replace(/\n/g, ' | '), sideHit: top.id, missing: [...I18N.missing] }; });
    await p.keyboard.press('Escape'); await p.waitForTimeout(500); r.escClosed = !(await p.evaluate(() => document.body.classList.contains('menu-open')));
    await p.click('#burger'); await p.waitForTimeout(500); const side = r.dir === 'rtl' ? r.w - 15 : 15; await p.mouse.click(side, 400); await p.waitForTimeout(500);
    r.bdClosed = !(await p.evaluate(() => document.body.classList.contains('menu-open')));
    await p.click('#burger'); await p.waitForTimeout(500); await p.click('#menu nav a[href="#/help"]'); await p.waitForTimeout(600);
    r.itemNav = await p.evaluate(() => location.hash + ' ' + !document.body.classList.contains('menu-open'));
    await p.screenshot({ path: `shots/nav-${dev}-${lang}-help.png` });
    r.errs = errs; out[dev + '-' + lang] = r;
    const okSide = r.dir === 'rtl' ? r.left === 0 : r.right === r.w;
    if (!okSide || r.overflow !== 'hidden' || !r.escClosed || !r.bdClosed || !r.itemNav.endsWith('true') || r.sideHit !== 'menu-bd' || errs.length || r.missing.length || (lang === 'ar') !== (r.dir === 'rtl')) bad++;
    await ctx.close(); }
  console.log(JSON.stringify(out, null, 1)); console.log(bad ? 'FAIL ' + bad : 'ALL OK'); await b.close(); process.exit(bad ? 1 : 0);
})();

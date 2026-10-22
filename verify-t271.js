// t271：首页引导面板 × 关闭、记忆、重新打开；RTL；不与 FAB 重叠
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), { chromium } = require('playwright');
const D = __dirname, wait = ms => new Promise(r => setTimeout(r, ms)); let ok = 0, bad = 0; const chk = (c, m) => { c ? ok++ : bad++; console.log((c ? '✅ ' : '❌ ') + m); };
(async () => { let srv, B = process.env.WT_BASE;
  if (!B) { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-271-')), port = 18971; B = 'http://127.0.0.1:' + port;
    for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f));
    fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data'); fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
    srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', OPENAI_API_KEY: '', PRICE_MOCK: '1' }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/health'); break; } catch { await wait(250); } } }
  const br = await chromium.launch(), shot = process.env.WT_SHOTS;
  for (const L of ['en', 'ar', 'zh-CN']) { const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addInitScript(l => { localStorage.gq_guide_dismissed = '1'; localStorage.wt_lang = l; }, L); const pg = await ctx.newPage();
    await pg.goto(B + '/#/'); await pg.waitForSelector('#hgrow .hg-x', { timeout: 30000 }); await wait(shot ? 9000 : 2500);
    const x = await pg.$eval('#hgrow .hg-x', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom, a: e.getAttribute('aria-label') }; });
    chk(x.w >= 40 && x.h >= 40, `${L} × is ${x.w}x${x.h}, aria-label "${x.a}"`);
    const fabs = await pg.$$eval('.fab,#fab,#qbtn', l => l.filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    chk(fabs.every(f => x.r <= f.l || x.l >= f.r || x.b <= f.t || x.t >= f.b), `${L} × does not overlap floating buttons`);
    const g = await pg.$eval('#hgrow', e => e.getBoundingClientRect()); chk(L !== 'ar' || x.l - g.left < 60, `${L} RTL: × sits at the inline end (left)`);
    if (shot && L === 'en') await pg.screenshot({ path: `${D}/shots/t271-${shot}-open.png` });
    await pg.click('#hgrow .hg-x'); await wait(500);
    chk(await pg.evaluate(() => getComputedStyle(document.querySelector('#hgrow')).visibility === 'hidden' && localStorage.gq_grow_closed === '1' && document.querySelector('#hgopen').getClientRects().length > 0), `${L} closes + remembered + re-open chip shown`);
    if (shot && L === 'en') await pg.screenshot({ path: `${D}/shots/t271-${shot}-closed.png` });
    await pg.reload(); await wait(3000); chk(await pg.evaluate(() => document.body.classList.contains('grow-closed')), `${L} stays closed after reload`);
    await pg.click('#hgopen'); await wait(500); chk(await pg.evaluate(() => getComputedStyle(document.querySelector('#hgrow')).visibility === 'visible' && !localStorage.gq_grow_closed), `${L} re-open chip restores panel`);
    await pg.click('#hgrow .hg-x'); await wait(400); await pg.click('#burger'); await wait(500); await pg.click('#menu a[href="#/free"]'); await wait(500); chk(await pg.evaluate(() => !localStorage.gq_grow_closed), `${L} menu 免费心愿 also re-opens`);
    await ctx.close(); }
  await br.close(); srv?.kill(); console.log(`\n${ok} pass, ${bad} fail`); process.exit(bad ? 1 : 0); })();

// t273：详情页 ← 返回按钮 + 浏览器/安卓返回手势；返回来源并重开卡片弹窗
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), { chromium } = require('playwright');
const D = __dirname, wait = ms => new Promise(r => setTimeout(r, ms)); let ok = 0, bad = 0; const chk = (c, m) => { c ? ok++ : bad++; console.log((c ? '✅ ' : '❌ ') + m); };
(async () => { let srv, B = process.env.WT_BASE;
  if (!B) { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-273-')), port = 18973; B = 'http://127.0.0.1:' + port;
    for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f));
    fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
    srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', OPENAI_API_KEY: '' }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/health'); break; } catch { await wait(250); } } }
  const br = await chromium.launch({ executablePath: process.env.WT_CHROME || undefined }), shot = process.env.WT_SHOTS;
  for (const L of (process.env.WT_LANGS || 'en,ar,zh-CN').split(',')) { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await ctx.addInitScript(l => { localStorage.gq_guide_dismissed = '1'; localStorage.wt_lang = l; }, L); const pg = await ctx.newPage();
    await pg.goto(B + '/#/'); await pg.waitForFunction(() => window.__S?.wishes?.length > 1, null, { timeout: 60000 }); await wait(3000);
    const sig0 = await pg.evaluate(() => { const w = __S.wishes[0]; openCardPopup(w); return w.sig; }); await wait(800);
    await pg.click('#modal a[href^="#/w/"]'); await pg.waitForSelector('.det-back'); await wait(800);
    const b = await pg.$eval('.det-back', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom, a: e.getAttribute('aria-label'), x: e.textContent.trim() }; });
    chk(b.w >= 40 && b.h >= 40, `${L} back button ${Math.round(b.w)}x${Math.round(b.h)} "${b.x}"`);
    chk(L === 'ar' ? b.r > 300 : b.l < 90, `${L} back sits at inline start (${L === 'ar' ? 'right' : 'left'})`);
    const fabs = await pg.$$eval('.fab,#fab,#qbtn', l => l.filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    chk(fabs.every(f => b.r <= f.l || b.l >= f.r || b.b <= f.t || b.t >= f.b), `${L} back does not overlap floating buttons`);
    if (shot && L === 'en') await pg.screenshot({ path: `${D}/shots/t273-${shot}-detail.png` });
    const hasNext = await pg.$('#swbar [data-sw="1"]:not([aria-disabled])'); if (hasNext) { await hasNext.click(); await wait(900); }
    const cur = await pg.evaluate(() => decodeURIComponent(location.hash.split('/w/')[1].split('?')[0]));
    await pg.click('.det-back'); await wait(1800);
    const st = await pg.evaluate(() => ({ h: location.hash, m: !document.querySelector('#modal').hidden }));
    chk(!st.h.startsWith('#/w/') && st.m, `${L} ← Back returns to tree (${st.h}) and reopens card viewer${hasNext ? ' after paging' : ''}`);
    if (shot && L === 'en') await pg.screenshot({ path: `${D}/shots/t273-${shot}-after-back.png` });
    await pg.evaluate(() => closeModal()); await pg.evaluate(s => openCardPopup(__S.wishes.find(w => w.sig === s)), sig0); await wait(600);
    await pg.click('#modal a[href^="#/w/"]'); await pg.waitForSelector('.det-back'); await wait(600); await pg.goBack(); await wait(1800);
    const g = await pg.evaluate(() => ({ h: location.hash, m: !document.querySelector('#modal').hidden }));
    chk(!g.h.startsWith('#/w/') && g.m, `${L} browser/Android back gesture returns + reopens viewer`);
    await pg.goto(B + '/#/w/' + encodeURIComponent(cur)); await pg.waitForSelector('.det-back', { timeout: 30000 }); await wait(500); await pg.click('.det-back'); await wait(1200);
    chk(await pg.evaluate(() => location.hash === '#/' || location.hash === ''), `${L} direct-opened detail → Back goes home`);
    await ctx.close(); }
  await br.close(); srv?.kill(); console.log(`\n${ok} pass, ${bad} fail`); process.exit(bad ? 1 : 0); })();

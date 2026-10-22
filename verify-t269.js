// t269：非中文界面不应出现中文（用户内容经自动翻译除外）；默认语言回退英文
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), { chromium } = require('playwright');
const D = __dirname, wait = ms => new Promise(r => setTimeout(r, ms)); let ok = 0, bad = 0; const chk = (c, m) => { c ? ok++ : bad++; console.log((c ? '✅ ' : '❌ ') + m); };
const BASE = process.env.WT_BASE;
(async () => {
  let srv, B = BASE;
  if (!B) { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-269-')), port = 18969; B = 'http://127.0.0.1:' + port;
    for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f));
    fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
    fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
    srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', OPENAI_API_KEY: '', PRICE_MOCK: '1' }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/health'); break; } catch { await wait(250); } } }
  const br = await chromium.launch(process.env.WT_CHROME ? { executablePath: process.env.WT_CHROME } : {});
  const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  const leaks = async pg => pg.evaluate(() => { const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const s = n.textContent.trim(); if (!s || !/[\u4e00-\u9fff]/.test(s)) continue; const el = n.parentElement; if (!el || el.closest('.ut,[data-ut],#langmenu,script,style,[lang^=zh],.debug-only,[hidden]') || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue; out.push(s.slice(0, 50)); }
    for (const e of document.querySelectorAll('[aria-label],[title],[placeholder]')) for (const a of ['aria-label', 'title', 'placeholder']) { const v = e.getAttribute(a); if (v && /[\u4e00-\u9fff]/.test(v) && !e.closest('#langmenu,[lang^=zh]')) out.push(a + ':' + v.slice(0, 40)); }
    return [...new Set(out)]; });
  // 1) 不支持的浏览器语言 → 英文；首屏 HTML 无中文
  { const ctx = await br.newContext({ locale: 'sw-KE', viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage();
    const html = await (await fetch(B + '/', { headers: { 'accept-language': 'sw-KE' } })).text(), head = html.split('</head>')[0];
    chk(/<html lang="en"/.test(html), 'static html lang=en'); chk(!CJK.test(head.replace(/<style[\s\S]*?<\/style>/g, '').replace(/name="keywords"[^>]*>/, '')), 'static <head> meta has no Chinese (keywords excepted)');
    chk(!CJK.test(html.split('<body')[1].replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/lang="zh[^>]*>[^<]*/g, '')), 'static <body> text (first paint) has no Chinese');
    await ctx.addInitScript(() => { localStorage.gq_guide_dismissed = '1'; }); await pg.goto(B + '/#/'); await wait(3000);
    chk(await pg.evaluate(() => I18N.lang) === 'en', 'unsupported browser language → en'); chk(/Guangqi/.test(await pg.title()), 'title English: ' + await pg.title()); await ctx.close(); }
  const routes = ['/', '/list', '/wish/make', '/free', '/help', '/rules', '/terms', '/wallet-guide', '/origin', '/treehole', '/me', '/wish'];
  for (const L of (process.env.WT_LANGS || 'en,es').split(',')) { const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addInitScript(l => { localStorage.gq_guide_dismissed = '1'; localStorage.wt_lang = l; }, L); const pg = await ctx.newPage();
    for (const r of routes) { await pg.goto(B + '/#' + r); await wait(r === '/' ? 3500 : 1500); const lk = await leaks(pg); chk(!lk.length, `${L} ${r} no Chinese UI text${lk.length ? ': ' + JSON.stringify(lk.slice(0, 8)) : ''}`);
      if (process.env.WT_SHOTS && ['/', '/wish/make', '/rules', '/terms'].includes(r)) await pg.screenshot({ path: `${D}/shots/t269-${process.env.WT_SHOTS}-${L}-${r === '/' ? 'home' : r.slice(1).replace(/\//g, '-')}.png` }); }
    if (process.env.WT_SHOTS) { await pg.goto(B + '/#/'); await wait(2500); await pg.click('#burger'); await wait(600); await pg.screenshot({ path: `${D}/shots/t269-${process.env.WT_SHOTS}-${L}-menu.png` }); }
    await ctx.close(); }
  await br.close(); srv?.kill(); console.log(`\n${ok} pass, ${bad} fail`); process.exit(bad ? 1 : 0);
})();

// t278：新增 10 种界面语言（it nl pl uk fa bn ur fil ms sw，共 26 种）：完整翻译、语言菜单、浏览器语言检测、fa/ur RTL、译文目标列表、og/hreflang/sitemap
// 本地：node verify-t278.js（自启服务）；线上：WT_BASE=https://guangqi.world WT_API=https://world-tree-ijv1.onrender.com；WT_SHOTS=1 截图到 shots/t278-*
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), { chromium } = require('playwright');
const D = __dirname, wait = ms => new Promise(r => setTimeout(r, ms)); let ok = 0, bad = 0; const chk = (c, m) => { c ? ok++ : bad++; console.log((c ? '✅ ' : '❌ ') + m); };
const NEW = ['it', 'nl', 'pl', 'uk', 'fa', 'bn', 'ur', 'fil', 'ms', 'sw'], RTL = ['fa', 'ur'];
(async () => { let srv, B = process.env.WT_BASE, API = process.env.WT_API;
  if (!B) { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-278-')), port = 18978; B = 'http://127.0.0.1:' + port;
    for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f));
    fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
    srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', OPENAI_API_KEY: '' }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/health'); break; } catch { await wait(250); } } }
  API = API || B;
  // 静态资源
  const en = await (await fetch(B + '/i18n/en.json')).json(), ek = Object.keys(en);
  for (const L of NEW) { const r = await fetch(B + '/i18n/' + L + '.json'); const j = r.ok ? await r.json() : {}; const miss = ek.filter(k => !(k in j)), same = ek.filter(k => j[k] === en[k] && /[a-z]{4} [a-z]{4}/.test(en[k]));
    const ph = ek.filter(k => (en[k].match(/\{\w+\}/g) || []).sort().join() !== ((j[k] || '').match(/\{\w+\}/g) || []).sort().join());
    chk(r.ok && !miss.length && same.length < 25 && !ph.length, `${L}.json: ${Object.keys(j).length} keys, missing ${miss.length}, untranslated≈${same.length}, placeholder mismatch ${ph.length}`);
    chk(!/还愿|gas[ -]?included/i.test(JSON.stringify(j)), `${L}: no 还愿 / gas-included wording`);
    chk((await fetch(B + '/og/og-' + L + '.png')).ok, `${L}: og image`); }
  const html = await (await fetch(B + '/')).text(); chk(NEW.every(L => html.includes(`hreflang="${L}"`)), 'index.html hreflang ×10 new');
  if (!process.env.WT_BASE) { const sm = fs.readFileSync(D + '/public/sitemap.xml', 'utf8'); chk(NEW.every(L => sm.includes(`?lang=${L}</loc>`)), 'sitemap urls ×10 new'); }
  for (const L of NEW) { const r = await fetch(API + '/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: L, items: [] }) }); chk(r.status !== 400 || !/target/.test(await r.text()), `/api/translate accepts target ${L} (${r.status})`); }
  const br = await chromium.launch({ executablePath: process.env.WT_CHROME || undefined }); const shots = process.env.WT_SHOTS; if (shots) fs.mkdirSync(D + '/shots', { recursive: true });
  const openLang = async pg => { if (!(await pg.isVisible('#langbtn'))) { await pg.click('#burger'); await wait(500); } await pg.click('#langbtn'); await pg.$eval('#langmenu', m => m.scrollIntoView({ block: 'end' })); await wait(300); };
  const ctxOf = async (o = {}) => { const c = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...o }); await c.addInitScript(() => { localStorage.gq_guide_dismissed = '1'; }); return c; };
  for (const L of NEW) { const ctx = await ctxOf(), pg = await ctx.newPage(), errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(B + '/?lang=' + L, { waitUntil: 'domcontentloaded' }); await pg.waitForFunction(l => window.I18N && I18N.lang === l, L, { timeout: 20000 }).catch(() => {}); await wait(1500);
    const i = await pg.evaluate(() => ({ lang: I18N.lang, hl: document.documentElement.lang, dir: document.documentElement.dir, miss: [...(I18N.missing || [])], n: document.querySelectorAll('#langmenu li[data-lang]').length, title: document.title, sel: document.querySelector('#langmenu li[aria-selected=true]')?.dataset.lang, ow: document.documentElement.scrollWidth }));
    chk(i.lang === L && i.hl === L && !i.miss.length && !errs.length, `${L}: UI loads (html lang=${i.hl}, missing ${i.miss.length}, errors ${errs.length}) title="${i.title}"`);
    chk((i.dir === 'rtl') === RTL.includes(L), `${L}: dir=${i.dir}`); chk(i.n === 26 && i.sel === L, `${L}: switcher lists ${i.n} languages, selected ${i.sel}`); chk(i.ow <= 392, `${L}: no horizontal overflow (${i.ow}px)`);
    if (shots && (L === 'fa' || L === 'it')) { await pg.screenshot({ path: `${D}/shots/t278-home-${L}.png` }); }
    if (shots && L === 'fa') { await openLang(pg); await wait(500); await pg.screenshot({ path: `${D}/shots/t278-lang-menu-fa.png` }); }
    if (shots && L === 'it') { await openLang(pg); await wait(500); await pg.screenshot({ path: `${D}/shots/t278-lang-menu-top.png` });
      await pg.$eval('#langmenu', m => m.scrollTop = m.scrollHeight); await wait(300); await pg.screenshot({ path: `${D}/shots/t278-lang-menu-bottom.png` }); }
    await ctx.close(); }
  // 切换器：点击切换到新语言
  { const ctx = await ctxOf(), pg = await ctx.newPage(); await pg.goto(B + '/?lang=en'); await pg.waitForFunction(() => window.I18N && I18N.lang === 'en'); await wait(800);
    await openLang(pg); await pg.click('#langmenu li[data-lang="ur"]'); await pg.waitForFunction(() => I18N.lang === 'ur', null, { timeout: 15000 }).catch(() => {}); await wait(800);
    chk(await pg.evaluate(() => I18N.lang === 'ur' && document.documentElement.dir === 'rtl' && localStorage.wt_lang === 'ur'), 'switcher click → ur, RTL, saved'); await ctx.close(); }
  // 浏览器语言自动检测
  for (const [loc, want] of [['it-IT', 'it'], ['nl-NL', 'nl'], ['pl-PL', 'pl'], ['uk-UA', 'uk'], ['fa-IR', 'fa'], ['bn-BD', 'bn'], ['ur-PK', 'ur'], ['fil-PH', 'fil'], ['tl-PH', 'fil'], ['ms-MY', 'ms'], ['sw-KE', 'sw']]) {
    const ctx = await ctxOf({ locale: loc }), pg = await ctx.newPage(); await pg.goto(B + '/'); await pg.waitForFunction(() => window.I18N && I18N.lang, null, { timeout: 15000 }).catch(() => {});
    chk(await pg.evaluate(() => I18N.lang) === want, `browser ${loc} → ${want}`); await ctx.close(); }
  await br.close(); srv?.kill(); console.log(`\n${ok} pass, ${bad} fail`); process.exit(bad ? 1 : 0); })();

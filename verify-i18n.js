// 国际化验证：移动端视口，zh-CN / en / ar / ja；检查控制台错误（忽略 devnet 不可达）、缺失翻译键、<html lang/dir>，截图到 shots/i18n-*.png
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const IGNORE = /devnet|api\.devnet|ERR_|Failed to load resource|RPC|net::|fetch/i;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.WT_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = {}; let bad = 0;
  for (const lang of ['zh-CN', 'en', 'ar', 'ja']) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], locale: lang }); const p = await ctx.newPage(); const errs = [];
    p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    const q = lang === 'zh-CN' ? '' : '?lang=' + lang; // zh-CN 走 navigator.language 自动检测
    await p.goto(BASE + q); await p.waitForSelector('#scene canvas', { timeout: 60000 }); await p.waitForTimeout(3000);
    await p.screenshot({ path: `shots/i18n-${lang}-home.png` });
    await p.click('#burger'); await p.waitForTimeout(500); await p.click('#langbtn'); await p.waitForTimeout(300); await p.screenshot({ path: `shots/i18n-${lang}-menu.png` }); await p.click('#langbtn'); await p.click('#menu-x'); await p.waitForTimeout(400); // 语言切换器在抽屉菜单里
    for (const h of ['#/list', '#/wish', '#/me', '#/w/SAMPLE0', '#/help', '#/terms']) { await p.goto(BASE + q + h); await p.waitForTimeout(500); }
    await p.screenshot({ path: `shots/i18n-${lang}-terms.png`, fullPage: true });
    await p.goto(BASE + q + '#/help'); await p.waitForTimeout(400); await p.screenshot({ path: `shots/i18n-${lang}-help.png` });
    await p.goto(BASE + q + '#/w/SAMPLE0'); await p.waitForTimeout(400); await p.screenshot({ path: `shots/i18n-${lang}-detail.png` });
    // 演示登录 + 审核拒绝信息
    await p.evaluate(async () => { const r = await (await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'i18n@example.com' }) })).json(); localStorage.wt_token = r.token; localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }); // 演示邮箱登录（API）
    await p.goto(BASE + q + '#/wish'); await p.reload(); await p.waitForSelector('#mkbtn', { timeout: 60000 }); await p.click('#mkbtn'); await p.waitForSelector('#wt', { timeout: 60000 }); await p.waitForTimeout(500); for (const id of ['#ag2', '#ag']) if (await p.$(id) && !(await p.isChecked(id))) await p.click(`label:has(${id}) span`); // 像用户一样点勾选框文字
    await p.fill('#wt', lang === 'ja' ? '殺してやる' : lang === 'en' ? 'I will kill you' : '加微信稳赚不赔'); await p.click('#ws'); await p.waitForTimeout(1200);
    const reject = (await p.textContent('#toasts')).trim();
    await p.screenshot({ path: `shots/i18n-${lang}-wish.png` });
    const info = await p.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, missing: [...I18N.missing], stored: localStorage.wt_lang, nav: document.querySelector('nav').innerText.replace(/\n/g, ' | ') }));
    const realErrs = errs.filter(e => !IGNORE.test(e));
    results[lang] = { ...info, reject: reject.slice(-160), consoleErrors: realErrs, ignoredErrors: errs.length - realErrs.length };
    if (info.lang !== lang || info.missing.length || realErrs.length || (lang === 'ar') !== (info.dir === 'rtl')) bad++;
    await ctx.close();
  }
  // 切换器：点击菜单切换语言并持久化
  const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'en-US' }); const p = await ctx.newPage();
  await p.goto(BASE + '#/help'); await p.waitForTimeout(1500); const auto = await p.evaluate(() => document.documentElement.lang);
  await p.click('#burger'); await p.waitForTimeout(500); await p.click('#langbtn'); await p.click('#langmenu [data-lang=ko]'); await p.waitForTimeout(800);
  const after = await p.evaluate(() => ({ lang: document.documentElement.lang, h2: document.querySelector('#view h2')?.textContent, stored: localStorage.wt_lang }));
  await p.reload(); await p.waitForTimeout(1500); const persisted = await p.evaluate(() => document.documentElement.lang);
  results.switcher = { autoDetected: auto, afterClick: after, afterReload: persisted }; if (auto !== 'en' || after.lang !== 'ko' || persisted !== 'ko') bad++;
  // 全部语言 JSON 键完整性
  const base = await (await fetch(BASE + 'i18n/zh-CN.json')).json(), miss = {};
  for (const l of Object.keys(await p.evaluate(() => I18N.LANGS))) { const d = await (await fetch(BASE + 'i18n/' + l + '.json')).json(); const m = Object.keys(base).filter(k => !(k in d)); if (m.length) { miss[l] = m; bad++; } }
  results.missingKeysPerLangFile = miss;
  console.log(JSON.stringify(results, null, 1)); console.log(bad ? 'FAIL ' + bad : 'ALL OK'); await b.close(); process.exit(bad ? 1 : 0);
})();

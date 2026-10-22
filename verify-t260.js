// t260：卡片内容自动翻译（线上）。node verify-t260.js [base]；截图 SHOTS=shots → shots/t260-live-*.png
const { chromium } = require('playwright'), assert = require('assert');
const B = process.argv[2] || 'https://guangqi.world', SH = process.env.SHOTS || 'shots', API = 'https://world-tree-ijv1.onrender.com';
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
(async () => {
  // 服务端：免费提供方 + 缓存
  const r1 = await (await fetch(API + '/api/translate', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ target: 'en', source: 'zh-CN', texts: ['希望家人平安健康'] }) })).json();
  ok(r1.items?.[0]?.t && /health|safe|family/i.test(r1.items[0].t), 'server /api/translate zh→en: ' + r1.items?.[0]?.t);
  const r2 = await (await fetch(API + '/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'en', source: 'zh-CN', texts: ['希望家人平安健康'] }) })).json();
  ok(r2.items[0].t === r1.items[0].t, 'second call served (cache)');
  const st = await (await fetch(API + '/api/translate/stats')).json(); ok(st.cache >= 1, 'stats: ' + JSON.stringify(st));
  ok((await fetch(API + '/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'xx', texts: ['a'] }) })).status === 400, 'bad target rejected');
  const br = await chromium.launch();
  for (const L of ['ja', 'en']) {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const p = await ctx.newPage(), sent = []; p.on('request', q => { if (q.url().includes('/api/translate')) try { sent.push(...JSON.parse(q.postData()).texts); } catch {} });
    await p.goto(`${B}/?lang=${L}#/list`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.ut[data-uts=done]', { timeout: 60000 });
    const info = await p.evaluate(() => ({ done: document.querySelectorAll('.ut[data-uts=done]').length, all: document.querySelectorAll('.ut').length, lockedUt: document.querySelectorAll('.locked-card .ut').length, ctl: document.querySelectorAll('.ut-ctl').length, lbl: document.querySelector('.ut-lbl')?.textContent, prov: WTTr.provider }));
    ok(info.done > 0 && info.ctl > 0, `${L} list: ${info.done}/${info.all} translated, label "${info.lbl}", provider ${info.prov}`);
    ok(info.lockedUt === 0, `${L} locked cards carry no translatable text`);
    const privTexts = await p.evaluate(() => (window.__S?.wishes || []).filter(w => w.priv || w.lockedView || w.cipher).map(w => w.text));
    ok(!sent.some(s => privTexts.includes(s)), `${L} no private/locked text sent (${sent.length} texts sent)`);
    const el = await p.$('.card[data-cid] .ut[data-uts=done]'); await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(800);
    await p.screenshot({ path: `${SH}/t260-live-${L}-list.png` });
    await el.click(); await p.waitForTimeout(1500);
    const qv = await p.waitForSelector('#modal .ut[data-uts=done], .qv .ut[data-uts=done], [class*=qv] .ut[data-uts=done]', { timeout: 30000 }).catch(() => null);
    if (!qv) { const pg = await p.$('[class*=qv] [class*=next], .qv-next'); if (pg) { await pg.click(); await p.waitForTimeout(1500); } }
    const q2 = qv || await p.waitForSelector('.ut[data-uts=done]:visible', { timeout: 20000 });
    await p.waitForTimeout(600); await p.screenshot({ path: `${SH}/t260-live-${L}-quickview.png` });
    const tg = await p.evaluateHandle(e => (e.closest('.card,.gq-inside,.sp-body,.fold-inbody,.cf-over,.qv-page') || document).querySelector('.ut-tg'), q2);
    const before = await q2.textContent(); await tg.asElement().click(); await p.waitForTimeout(400);
    const after = await q2.evaluate(e => [e.textContent, e.dataset.ut]); ok(after[0] === after[1] && after[0] !== before, `${L} toggle → original: "${after[0].slice(0, 30)}"`);
    await p.screenshot({ path: `${SH}/t260-live-${L}-original.png` });
    await tg.asElement().click(); await p.waitForTimeout(300); ok((await q2.textContent()) === before, `${L} toggle back → translation`);
    await p.evaluate(() => WTTr.set(false)); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !document.querySelector('.ut-on') && !document.querySelector('.ut-ctl')), `${L} global switch off restores originals`);
    if (L === 'ja') { await p.keyboard.press('Escape'); await p.evaluate(() => { location.hash = '#/list'; }); await p.waitForTimeout(800); await p.click('#burger'); await p.waitForTimeout(600); await p.click('#langbtn'); await p.waitForTimeout(400); await p.$eval('#autotr', e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300); await p.screenshot({ path: `${SH}/t260-live-ja-switch.png` });
      ok(/☐/.test(await p.textContent('#autotr')), 'ja language menu shows auto-translate switch (off)'); await p.click('#autotr'); await p.waitForTimeout(300); ok(/☑/.test(await p.textContent('#autotr')) && await p.evaluate(() => WTTr.on()), 'menu switch turns it back on'); }
    await p.evaluate(() => WTTr.set(true)); await ctx.close();
  }
  await br.close(); console.log(`t260 OK ${n} checks`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });

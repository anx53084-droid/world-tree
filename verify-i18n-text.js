// 全站文案语言检查：每种非中文语言下遍历页面/菜单/弹窗/表单，收集可见文本与 placeholder/title/aria-label，
// 去掉用户内容（愿望/祝福原文）与品牌「光栖」后，若仍含汉字则失败；ja 允许汉字（改为检查缺失 key）。用法：BASE=... node verify-i18n-text.js
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8080/', LANGS = (process.env.LANGS || 'en,ja,ko,es,fr,de,pt,ru,ar,hi,id,th,vi,tr').split(',');
const zh = JSON.parse(fs.readFileSync(__dirname + '/public/i18n/zh-CN.json'));
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const f of fs.readdirSync(__dirname + '/public/i18n')) { const d = JSON.parse(fs.readFileSync(__dirname + '/public/i18n/' + f)); const miss = Object.keys(zh).filter(k => !(k in d)); if (miss.length) { bad++; console.log('MISSING', f, miss.join(',')); } }
  const ctx0 = await b.newContext(); const p0 = await ctx0.newPage(); await p0.goto(BASE + 'x'); const tok = await p0.evaluate(async () => (await (await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'i18n-check@test.dev' }) })).json()).token); await ctx0.close();
  for (const lang of LANGS) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const hits = new Set();
    const grab = async where => { const r = await p.evaluate(() => { const uc = new Set(); (S.wishes || []).forEach(w => { uc.add(w.text); w.blessings.forEach(x => uc.add(x.text)); });
        const out = []; const walk = n => { if (n.nodeType === 3) { const s = n.textContent.trim(); const el = n.parentElement; if (s && el && el.offsetParent !== null || (s && el && getComputedStyle(el).position === 'fixed')) out.push(s); return; } if (n.nodeType !== 1) return; const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return;
          for (const a of ['placeholder', 'title', 'aria-label']) if (n.getAttribute(a)) out.push(n.getAttribute(a)); n.childNodes.forEach(walk); };
        walk(document.body); out.push(document.title); let txt = out.join('\n'); [...uc].sort((a, b) => b.length - a.length).forEach(u => { if (u) txt = txt.split(u).join(''); }); return txt.replace(/光栖|光棲/g, ''); });
      for (const line of r.split('\n')) if (/\p{Script=Han}/u.test(line)) hits.add(where + ': ' + line.slice(0, 80)); };
    await p.goto(BASE + `?sample=1&lang=${lang}`); await p.waitForSelector('#burger', { timeout: 90000 }); await p.waitForTimeout(3000);
    for (const r of ['#/', '#/list', '#/me', '#/help', '#/terms', '#/origin', '#/w/SAMPLE0', '#/w/SAMPLEF1', '#/w/SAMPLEP0']) { await p.evaluate(h => location.hash = h, r); await p.waitForTimeout(r === '#/origin' ? 1500 : 600); await grab(r); }
    await p.evaluate(() => location.hash = '#/'); await p.waitForTimeout(800); await p.click('#burger'); await p.waitForTimeout(500); await p.click('#gq'); await grab('menu'); await p.click('#menu-x').catch(() => {});
    for (const s of ['SAMPLEF1', 'SAMPLEP0', 'SAMPLE2']) { await p.evaluate(sig => { const w = S.wishes.find(x => x.sig === sig); openCardPopup(w); }, s); await p.waitForTimeout(1500); await grab('popup ' + s); await p.evaluate(() => closeModal()); }
    await p.evaluate(t => localStorage.wt_token = t, tok); await p.goto(BASE + `?sample=1&lang=${lang}#/wish`); await p.reload(); await p.waitForSelector('#mkbtn', { timeout: 60000 }); await p.waitForTimeout(1500); await grab('mywish'); await p.click('#mkbtn'); await p.waitForSelector('#ctype', { timeout: 60000 }); await p.waitForTimeout(2500); await p.selectOption('#ctype', 'folded'); await p.selectOption('#wc2', '物质类'); await p.waitForSelector('#insides'); await grab('wish');
    await p.evaluate(() => location.hash = '#/me'); await p.waitForTimeout(800); await grab('me(login)');
    if (hits.size && lang !== 'ja') { bad++; console.log('HAN in', lang, '\n  ' + [...hits].join('\n  ')); } else console.log('ok', lang, lang === 'ja' ? `(kanji allowed, ${hits.size} lines)` : '');
    await ctx.close(); }
  await b.close(); console.log(bad ? 'FAIL ' + bad : 'PASS'); process.exit(bad ? 1 : 0);
})();

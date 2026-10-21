// t248：卡片快速查看（封面 / 内页 / 背面 完整显示 + 页签 + 滑动翻页）、点亮动效、分享图（卡面 + 正文 + 二维码 + 品牌角标）。QV_LIVE=1 时对线上只读验证（只点亮一次官方示范，不发交易）。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS, LIVE = process.env.QV_LIVE, PFX = SHOTS ? SHOTS + '/t249-' + (LIVE ? 'live-' : '') : '';
(async () => { let srv, Bs, browser, GQID, CLID;
  if (LIVE) { Bs = 'https://guangqi.world'; const s = (await (await fetch('https://world-tree-ijv1.onrender.com/api/offchain')).json()).samples; GQID = s.find(x => x.cat === '光栖' && x.cover === 0).id; CLID = s.find(x => x.cat === '经典').id; }
  else { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-qv-')), port = 18995; Bs = 'http://127.0.0.1:' + port;
    for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
    fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
    srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', PRICE_MOCK: '1', ADMIN_KEY: 'k-test' }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const add = async b => (await (await fetch(Bs + '/api/admin/samples', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'k-test' }, body: JSON.stringify(b) })).json()).id;
    CLID = await add({ text: '希望明年春天能和家人一起去看一次樱花，慢慢走，好好拍几张合照。', cat: '经典' }); GQID = await add({ text: '愿爸爸妈妈身体健康，每天都能睡个好觉，笑得比去年更多。', cat: '光栖', cover: 0 });
    const om = await (await fetch(Bs + '/api/og-meta/' + GQID)).json(); ok(om.cover === 0 && om.cat === '光栖' && om.official, 'og-meta：光栖套号'); }
  try { const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const errs = [];
    const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'zh-CN' }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    if (!LIVE) { await p.route(/\/api\/img\/c{32}/, r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync('/tmp/cs-cover.png') })); await p.route(/\/api\/img\/d{32}/, r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync('/tmp/qv-wide.png') })); }
    await p.goto(Bs + '/?lang=zh-CN'); await p.evaluate(() => { localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }); await p.reload();
    await p.waitForFunction(ids => typeof S !== 'undefined' && ids.every(i => S.wishes.some(w => w.sig === i)), [GQID, CLID], { timeout: 120000 });
    const geo = () => p.evaluate(() => { const st = document.querySelector('#qvStage').getBoundingClientRect(), on = document.querySelector('.qv-page.on'), r = on.getBoundingClientRect(), vis = [...document.querySelectorAll('.qv-page')].filter(x => getComputedStyle(x).opacity > .05).length;
      const art = on.querySelector('.qv-art, .gq-inside'), a = art?.getBoundingClientRect(), acts = document.querySelector('.qv-acts').getBoundingClientRect(), tabs = document.querySelector('.qv-tabs')?.getBoundingClientRect();
      return { st: [st.left, st.top, st.width, st.height].map(Math.round), page: [r.left, r.top, r.width, r.height].map(Math.round), art: a && [a.left, a.top, a.width, a.height].map(Math.round), vis, inView: st.left >= 0 && st.right <= innerWidth && st.top >= 0, actsBelow: acts.top >= st.bottom, tabsBelow: !tabs || tabs.top >= st.bottom, k: on.className }; });
    const open = async id => { await p.evaluate(id => { closeModal?.(); openCardPopup(S.wishes.find(w => w.sig === id)); }, id); await p.waitForTimeout(900); };
    // 光栖
    await open(GQID); let g = await geo(); ok(/qv-inner/.test(g.k), '光栖：默认打开内页');
    ok(g.vis === 1 && g.inView && JSON.stringify(g.art) === JSON.stringify(g.page) && JSON.stringify(g.page) === JSON.stringify(g.st), '光栖内页：整页与卡片区域完全一致、未被裁切、无相邻页 ' + JSON.stringify(g));
    ok(Math.abs(g.st[2] / g.st[3] - 484 / 720) < .01, '光栖：卡片区域比例 = 卡面原图比例');
    ok(g.actsBelow && g.tabsBelow, '按钮 / 页签在卡片下方，不重叠');
    ok(JSON.stringify(await p.$$eval('.qv-tabs button', b => b.map(x => x.textContent))) === JSON.stringify(['封面', '内页', '背面']), '光栖页签：封面 / 内页 / 背面');
    ok((await p.textContent('.qv-inner .qv-meta')).includes('官方示范') && !(await p.textContent('.qv-inner .qv-meta')).includes('作者'), '官方示范：内页底部不显示作者');
    ok(await p.$eval('.qv-inner .qv-meta', e => { const c = getComputedStyle(e).color.match(/\d+/g).map(Number); return (c[0] + c[1] + c[2]) / 3 < 90; }), '内页底部信息：深色高对比');
    if (PFX) await p.screenshot({ path: PFX + 'qv-gq-inner.png' });
    await p.click('[data-qv="0"]'); await p.waitForTimeout(1000); g = await geo(); ok(/qv-cover/.test(g.k) && g.vis === 1 && JSON.stringify(g.art) === JSON.stringify(g.st), '页签 → 封面完整显示 ' + JSON.stringify(g)); if (PFX) await p.screenshot({ path: PFX + 'qv-gq-cover.png' });
    const sw = async dx => { const b = await p.$eval('#qvStage', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await p.mouse.move(b[0], b[1]); await p.mouse.down(); await p.mouse.move(b[0] + dx, b[1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(1000); };
    await sw(-120); ok(/qv-inner/.test((await geo()).k), '左滑 → 内页'); await sw(-120); g = await geo(); ok(/qv-back/.test(g.k) && g.vis === 1, '左滑 → 背面'); if (PFX) await p.screenshot({ path: PFX + 'qv-gq-back.png' });
    await sw(120); ok(/qv-inner/.test((await geo()).k), '右滑 → 返回内页');
    // t249：上一张 / 下一张
    { const q0 = await p.evaluate(() => ({ ...window.__qv })); ok(q0.idx >= 0 && q0.n >= 2 && await p.isVisible('[data-qvn="1"]') && await p.isVisible('[data-qvn="-1"]'), `‹ › 上一张 / 下一张按钮可见（${q0.idx + 1}/${q0.n}）`);
      ok((await p.textContent('.qv-hint')).includes('下一张'), '提示文字：翻过最后一页进入下一张');
      await sw(-120); ok(/qv-back/.test((await geo()).k), '左滑 → 背面（最后一页）'); if (PFX) await p.screenshot({ path: PFX + 'nav-before.png' });
      await sw(-120); const q1 = await p.evaluate(() => ({ ...window.__qv, c: window.__qv.cur() })); const exp = q0.idx + 1 < q0.n; ok(exp ? q1.sig !== q0.sig && q1.idx === q0.idx + 1 && q1.c === 'cover' : q1.sig === q0.sig, '最后一页再左滑 → 下一张卡的封面'); await p.waitForTimeout(500); if (PFX) await p.screenshot({ path: PFX + 'nav-next.png' });
      if (exp) { await sw(120); const q2 = await p.evaluate(() => ({ ...window.__qv, c: window.__qv.cur() })); ok(q2.sig === q0.sig && q2.c === 'back', '第一页再右滑 → 上一张卡的最后一页');
        await p.click('[data-qvn="1"]'); await p.waitForTimeout(800); ok((await p.evaluate(() => window.__qv.sig)) === q1.sig, '› 按钮 → 下一张'); await p.click('[data-qvn="-1"]'); await p.waitForTimeout(800); ok((await p.evaluate(() => window.__qv.sig)) === q0.sig, '‹ 按钮 → 上一张'); }
      await open(GQID); }
    // 点亮动效
    await p.click('.qv-acts [data-cheer]'); await p.waitForSelector('.qv-acts button.cheer.lit .spark', { timeout: 10000 }); await p.waitForTimeout(200); const fx = !!(await p.$('.qv-acts button.cheer.lit b.bump')) && !!(await p.$('.qv-acts button.cheer .ring')); if (PFX) await p.screenshot({ path: PFX + 'cheer-anim.png' });
    ok(fx && (await p.textContent('.qv-inner [data-cheern]')) === (await p.textContent('.qv-acts button.cheer b')), '点亮：光环 + 光点 + 计数跳动，内页计数同步');
    await p.waitForTimeout(2200); await open(GQID); ok(await p.$('.qv-acts button.cheer.lit[aria-pressed=true]'), '已点亮：重新打开仍保持发光');
    // 分享图（光栖）
    await p.click('#qvShare'); await p.waitForFunction(() => document.querySelector('#shimg')?.src.startsWith('data:image/png'), null, { timeout: 20000 }); await p.waitForTimeout(500);
    ok(await p.$eval('#shimg', i => i.naturalHeight === 1120), '分享图：生成（画面未被跨域污染）'); if (PFX) await p.screenshot({ path: PFX + 'share-gq.png' });
    if (PFX) await p.$eval('#shimg', i => i.src).then(s => fs.writeFileSync(PFX + 'share-gq-image.png', Buffer.from(s.split(',')[1], 'base64')));
    // 经典（非折页）与其他样式
    await open(CLID); const cl = await p.evaluate(() => !!document.querySelector('#qv')); if (cl) { g = await geo(); ok(g.vis === 1 && g.actsBelow, '经典卡：封面 + 内页翻页器，完整显示 + 按钮在下方'); }
    else ok(false, '经典卡应使用翻页器');
    if (PFX) await p.screenshot({ path: PFX + 'qv-classic.png' });
    await p.evaluate(id => { closeModal(); sharePng(S.wishes.find(w => w.sig === id)); }, CLID); await p.waitForFunction(() => document.querySelector('#shimg')?.src.startsWith('data:image/png'), null, { timeout: 20000 }); await p.waitForTimeout(500);
    if (PFX) { await p.screenshot({ path: PFX + 'share-classic.png' }); await p.$eval('#shimg', i => i.src).then(s => fs.writeFileSync(PFX + 'share-classic-image.png', Buffer.from(s.split(',')[1], 'base64'))); } ok(true, '经典分享图生成');
    if (!LIVE) { // 其他样式：折页自定义 / 分开 / 叠加 / 企业卡（模拟数据）
      for (const [nm, o, want] of [['fold', { folded: true, cimg: 'x'.repeat(32), cover: 2, inside: 1 }, ['cover', 'inner', 'back']], ['split', { cimg: 'x'.repeat(32) }, ['cover', 'inner']], ['overlay', { cimg: 'x'.repeat(32), ustyle: 'o' }, ['inner']], ['biz', { kind: 'biz', folded: true, cimg: 'x'.repeat(32), bname: '星叶科技', domain: 'starleaf.example.com', inside: 0 }, ['cover', 'inner', 'back']], ['classic-fold', { folded: true, cover: 3, inside: 2 }, ['cover', 'inner', 'back']], ['wide-fold', { folded: true, cimg: 'c'.repeat(32), nimg: 'd'.repeat(32), wideImg: 1 }, ['cover', 'inner', 'back']]]) {
        await p.evaluate(([nm, o]) => { closeModal(); const w = { sig: 'QV' + nm + 'x'.repeat(80), author: 'Auth' + '1'.repeat(40), time: 1791100000, text: '测试卡片内容：' + nm, cat: '经典', hue: 45, kind: 'wish', vis: 'public', deliver: 'tree', cover: 1, likers: new Set(), blessings: [], likes: 0, sample: true, ...o }; S.biz ||= {}; S.biz[w.sig] = { name: w.bname, domain: w.domain }; openCardPopup(w); }, [nm, o]); await p.waitForTimeout(900);
        const pg = await p.evaluate(() => window.__qv.pages); ok(JSON.stringify(pg) === JSON.stringify(want), `${nm}：页面 ${pg.join('/')}`); g = await geo(); ok(g.vis === 1 && JSON.stringify(g.page) === JSON.stringify(g.st) && g.inView && g.actsBelow, `${nm}：当前页完整、无相邻页、按钮在下方`);
        if (o.folded) { const sp = await p.evaluate(() => { const st = document.querySelector('#qvStage').getBoundingClientRect(), l = document.querySelector('.qv-page.on .sp-l')?.getBoundingClientRect(), r = document.querySelector('.qv-page.on .sp-r')?.getBoundingClientRect(); return l && r && { seam: Math.abs(l.right - r.left), inside: l.left >= st.left - 1 && r.right <= st.right + 1 && st.left >= 0 && st.right <= innerWidth, wide: !!document.querySelector('.qv-page.on .qv-spread.wide'), txt: (document.querySelector('.qv-page.on .sp-r')?.innerText || '').trim().length > 1, sw: st.width }; });
          ok(sp && sp.seam < 1.5 && sp.inside && sp.txt && sp.sw > 340, `${nm}：内页为对开（左右两页无缝相接于中缝、整宽不裁切、正文在右页）` + JSON.stringify(sp)); if (o.wideImg) ok(sp.wide, `${nm}：宽幅内页图横跨两页`);
          if (PFX) await p.screenshot({ path: PFX + `spread-${nm}.png` }); }
        if (pg.includes('cover')) { await p.evaluate(() => window.__qv.go('cover')); await p.waitForTimeout(1100); g = await geo(); ok(g.vis === 1 && (!g.art || JSON.stringify(g.art) === JSON.stringify(g.st)), `${nm}：封面完整`); } } }
    ok(!errs.length, '无页面错误 ' + errs.join(' | '));
    console.log(`\n✅ ${n} checks passed`);
  } finally { if (browser) await browser.close(); srv?.kill(); } })().catch(e => { console.error('FAIL', e.message); process.exit(1); });

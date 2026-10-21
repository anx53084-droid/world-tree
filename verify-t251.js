// t251：移动端 3D 树自适应、免费 vs 上链光点、「未上链」仅作者可见、成长状态行、低内容引导。T251_LIVE=1 时对线上只读验证。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS, LIVE = process.env.T251_LIVE, PFX = SHOTS ? SHOTS + '/t251-' + (LIVE ? 'live-' : '') : '';
(async () => { let srv, Bs, browser, F1, F2; const API = () => LIVE ? 'https://world-tree-ijv1.onrender.com' : Bs;
  const call = async (p, body, h = {}) => { const x = await fetch(API() + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); return x.json().catch(() => ({})); };
  if (LIVE) { Bs = 'https://guangqi.world'; F1 = process.env.T251_FREE; }
  else { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-251-')), port = 18996; Bs = 'http://127.0.0.1:' + port;
    for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
    fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
    srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', PRICE_MOCK: '1', ADMIN_KEY: 'k-test' }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const ADM = { 'x-admin-key': 'k-test' }; await call('/api/admin/samples', { text: '希望明年春天能和家人一起去看一次樱花。', cat: '经典' }, ADM); await call('/api/admin/samples', { text: '愿爸爸妈妈身体健康，每天都能睡个好觉。', cat: '光栖', cover: 2 }, ADM);
    const free = async (i, text) => { const h = { 'x-forwarded-for': '10.7.0.' + i }, c = await call('/api/free/challenge', null, h), [a, b] = c.q.match(/\d+/g).map(Number); return call('/api/free', { text, cat: '经典', cid: c.cid, ans: a + b, dev: 'dv' + i }, h); };
    const r1 = await free(1, '想学会弹一首吉他曲'), r2 = await free(2, '希望小狗健健康康'); F1 = r1; F2 = r2; ok(r1.id && r2.id, '本地：两条免费心愿'); }
  try { const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const errs = [];
    const mk = async (mine) => { const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'zh-CN' }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
      await p.goto(Bs + '/?lang=zh-CN'); await p.evaluate(m => { localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; if (m) localStorage.wt_free = JSON.stringify([m]); }, mine ? { id: mine.id, token: mine.token || '', text: mine.text || '', cat: '经典' } : null); await p.reload();
      await p.waitForFunction(() => window.WT3D && document.querySelector('#hgrow .hs-item, #hgrow .hg-free') && WT3D.stats().N > 0, null, { timeout: 60000 }); await p.waitForTimeout(5000); return p; };
    const p = await mk(LIVE ? (F1 ? { id: F1 } : null) : F1);
    const cv = await p.evaluate(() => { const c = document.querySelector('#scene canvas'), s = WT3D.stats(); return { w: c.clientWidth, h: c.clientHeight, pr: s.pr, q: s.q, free: s.freeLights, near: s.nearCards, N: s.N, wt: s.weighted }; });
    ok(cv.w === 390 && cv.h === 844 && cv.pr <= 1.5, '画布随屏幕尺寸（390×844）且 DPR ≤ 1.5 ' + JSON.stringify(cv));
    if (!LIVE) ok(cv.free === 2 && cv.wt < cv.N, '免费心愿为柔光小光点且以较小权重计入亮度');
    const g = await p.evaluate(() => ({ t: document.querySelector('#hgrow').innerText, strip: document.querySelectorAll('#hgrow .hs-item').length, href: document.querySelector('#hgrow .hg-free')?.getAttribute('href'), anim: getComputedStyle(document.querySelector('.hs-track') || document.body).animationName, r: document.querySelector('#hgrow').getBoundingClientRect().toJSON(), fab: document.querySelector('#qbtn')?.getBoundingClientRect().toJSON() }));
    ok(/已有 \d+ 张心愿卡/.test(g.t) && /星河/.test(g.t) && !/上链/.test(g.t), '成长状态行：只显示总数 + 亮度说明（无上链/未上链拆分）');
    ok(g.href === '#/free' && /免费写一个心愿/.test(g.t), '「免费写一个心愿」按钮');
    ok(g.strip >= 2 && g.anim === 'hsScroll', '官方示范心愿自动滚动条');
    ok(g.r.bottom <= 844 && (!g.fab || g.r.right <= g.fab.left + 1), '引导区不被搜索按钮遮挡');
    if (PFX) await p.screenshot({ path: PFX + 'tree-mobile.png' });
    if (PFX) { await p.evaluate(() => WT3D.camTo(14)); await p.waitForTimeout(2500); await p.screenshot({ path: PFX + 'lights.png' }); }
    const lab = async (pg, id) => pg.evaluate(async id => { const w = treeWishes().find(x => x.sig === id); openCardPopup(lockPaint(w)); await new Promise(r => setTimeout(r, 900)); const t = document.querySelector('#modal-box').innerText; document.querySelector('#modal [data-close], #modal .close, #mclose')?.click(); return t; }, id);
    if (F1) { const t = await lab(p, F1.id || F1); ok(/未上链/.test(t), '作者本人：卡片显示「未上链」'); if (PFX) { await lab(p, F1.id || F1); await p.evaluate(id => openCardPopup(lockPaint(treeWishes().find(x => x.sig === id))), F1.id || F1); await p.waitForTimeout(900); await p.screenshot({ path: PFX + 'label-author.png' }); } }
    const q = await mk(null); const fid = F1?.id || F1 || (await q.evaluate(() => treeWishes().find(w => w.offchain)?.sig));
    if (fid) { const t = await lab(q, fid); ok(!/未上链/.test(t), '其他访客：同一张卡不显示「未上链」'); if (PFX) { await q.evaluate(id => openCardPopup(lockPaint(treeWishes().find(x => x.sig === id))), fid); await q.waitForTimeout(900); await q.screenshot({ path: PFX + 'label-other.png' }); } }
    if (!LIVE) { const t = await lab(p, F2.id); ok(!/未上链/.test(t), '作者看他人的免费心愿：不显示「未上链」'); }
    ok(!errs.length, '无页面错误 ' + errs.join(' | '));
    console.log(`✅ ${n} checks passed`);
  } finally { await browser?.close(); srv?.kill(); } })().catch(e => { console.error('FAIL', e.message); process.exit(1); });

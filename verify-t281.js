// t281 树洞：传送门 / 开阔分区 / 固定编号挂点 验证：静态检查 + 后端 API（临时目录、模拟统计、不上链）+ 390px 页面截图（本地测试数据，带 LOCAL TEST DATA 标记）
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const pub = path.join(__dirname, 'public'), LANGS = 'zh-CN zh-TW en ja ko es fr de pt ru ar hi id vi th tr it nl pl uk fa bn ur fil ms sw'.split(' ');
let __lite;
(async () => {
  console.log('backend + UI');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-hollow-')), port = 19000 + Math.floor(Math.random() * 900);
  for (const f of fs.readdirSync(__dirname)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(__dirname, f), path.join(tmp, f));
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(tmp, 'node_modules')); fs.symlinkSync(pub, path.join(tmp, 'public')); fs.mkdirSync(path.join(tmp, 'data'));
  const srv = cp.spawn(process.execPath, ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', GATE_MOCK_STATS: '1', D1_API_TOKEN: '', D1_DATABASE_ID: '', CF_ACCOUNT_ID: '' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port, mock = m => fs.writeFileSync(path.join(tmp, 'data/gate-mock-stats.json'), JSON.stringify(m));
  const call = async (u, o = {}) => { const r = await fetch(B + u, { method: o.body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'cf-connecting-ip': o.ip || '10.0.0.1', ...(o.dev ? { 'x-wt-dev': o.dev } : {}), ...(o.tok ? { authorization: 'Bearer ' + o.tok } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j }; };
  const cap = async ip => { const c = (await call('/api/free/challenge', { ip })).j, [a, b] = c.q.match(/\d+/g).map(Number); return { cid: c.cid, ans: a + b }; };
  const post = async (o, text, door = 'first') => call('/api/hollow/msg', { ...o, body: { door, text, ...(await cap(o.ip)) } });
  let br;
  try { for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/nonce'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const U = []; for (let n = 0; n < 30; n++) U.push({ ...(await call('/api/login', { body: { email: 'z' + n + '@test.dev' } })).j, ip: '10.3.' + (n >> 4) + '.' + (n + 10), dev: 'dz-' + n });
    const slots = []; for (let n = 0; n < 30; n++) { const r = await post({ ...U[n], tok: U[n].token }, `Light ${n + 1}: the rain sounded kind tonight, keep going.`); slots.push(r.j.item?.slot); }
    ok(slots.every((v, i) => v === i), '服务端按顺序分配固定 slot 0..29：' + slots.slice(0, 5).join(',') + '…' + slots.at(-1));
    let r = await call('/api/hollow/msgs?door=first'); ok(r.j.items.every(m => Number.isInteger(m.slot)) && new Set(r.j.items.map(m => m.slot)).size === r.j.items.length, '列表返回 slot 且不重复');
    const H2 = require('./hollow'); ok(typeof H2 === 'object', 'module');
    const { chromium } = require('playwright'); br = await chromium.launch({ executablePath: process.env.WT_CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
    const page = async (u, lang = 'en') => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'cf-connecting-ip': u ? u.ip : '10.5.5.5' } });
      await ctx.addInitScript(([tok, dev, lang]) => { if (tok) localStorage.wt_token = tok; localStorage.wt_dev = dev; localStorage.wt_lang = lang; if (!localStorage.wt_hollow_lite) localStorage.wt_hollow_lite = '0'; }, [u?.token || '', u?.dev || 'dev-ui', lang]);
      const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs; await p.goto(B + '/hollow/?lang=' + lang); await p.waitForFunction(() => window.__hollow, null, { timeout: 20000 }); await p.waitForTimeout(2500); return p; };
    let p = await page(null); await p.evaluate(() => __hollow.start()); await p.waitForTimeout(3000);
    await p.screenshot({ path: path.join(shots, 't281-hall.png') });
    await p.evaluate(() => __hollow.setPose(-2.18, 16.7, 0.244, 0.14)); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(shots, 't281-portal.png') });
    await p.evaluate(() => __hollow.enter('first')); await p.waitForTimeout(3500); ok((await p.evaluate(() => __hollow.mode)) === 'corr', '进入 First Light 开阔世界');
    ok((await p.evaluate(() => __hollow.lights())) === 30, '30 盏光全部挂上');
    const sp = await p.evaluate(() => [__hollow.slotPos(0), __hollow.slotPos(23), __hollow.slotPos(24), __hollow.zoneOf(23), __hollow.zoneOf(24)]);
    ok(sp[3] === 1 && sp[4] === 2 && sp[0][2] > sp[2][2] && Math.abs(sp[0][0]) > 6 && Math.abs(sp[0][0]) < 7.5, '固定分区坐标：slot 0-23 → 第 1 区，24 → 第 2 区');
    await p.evaluate(() => __hollow.setPose(0, 18, 0, 0.12)); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(shots, 't281-open.png') });
    await p.evaluate(() => __hollow.setPose(1.5, 38, 0.62, 0.05)); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(shots, 't281-zone.png') });
    ok(await p.evaluate(() => [...document.querySelectorAll('#depth')].some(e => /Zone 1/.test(e.textContent))), 'HUD 显示 Zone 1');
    await p.evaluate(() => { const [x, y, z] = __hollow.slotPos(0); const s = -z - 7; __hollow.setPose(0, s, Math.atan2(-x, 7), Math.atan2(y - 1.62, Math.hypot(x, 7))); }); await p.waitForTimeout(800);
    const hit = await p.evaluate(() => { const id = __hollow.pickLight(); return __hollow.S.msgs.find(m => m.id === id)?.slot; }); ok(hit === 0, '对准光点 → 优先命中（slot ' + hit + '）');
    await p.evaluate(() => __hollow.setPose(0, 85, -0.6, 0.05)); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(shots, 't281-zone2.png') });
    ok(!p.errs.length, '无页面 JS 错误 ' + p.errs.join(' | ')); await p.context().close();
    p = await page(null, 'zh-CN'); await p.evaluate(() => { localStorage.wt_hollow_lite = '1'; }); await p.reload(); await p.waitForFunction(() => window.__hollow); await p.evaluate(() => { __hollow.start(); __hollow.enter('first'); }); await p.waitForTimeout(3500);
    await p.evaluate(() => __hollow.setPose(0, 150, 0, 0.05)); await p.waitForTimeout(1500); ok(__lite = await p.evaluate(() => __hollow.lite), 'Lite 模式'); ok(!p.errs.length, 'Lite 深处无 JS 错误 ' + p.errs.join(' | '));
    await p.screenshot({ path: path.join(shots, 't281-lite.png') }); await p.context().close();
  } catch (e) { ok(false, 'exception ' + e.stack); }
  finally { await br?.close(); srv.kill(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL OK'); process.exit(fail ? 1 : 0);
})();

// t281 树洞开阔分区世界验证：slot 固定挂点 + 区号 + 光点可点 + 截图（本地测试数据）
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const pub = path.join(__dirname, 'public'), LANGS = 'zh-CN zh-TW en ja ko es fr de pt ru ar hi id vi th tr it nl pl uk fa bn ur fil ms sw'.split(' ');
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
    const slots = [];
    for (let i = 0; i < 30; i++) { const u = { ...(await call('/api/login', { body: { email: 'z' + i + '@test.dev' } })).j, ip: '10.3.' + i + '.1', dev: 'dz' + i };
      const r = await post({ ...u, tok: u.token }, `Light ${i + 1}: someone out there is rooting for you.`); slots.push(r.j.item?.slot); }
    ok(slots.every((x, i) => x === i), '服务端按顺序分配固定 slot 0..29: ' + slots.join(','));
    const L = (await call('/api/hollow/msgs?door=first')).j.items; ok(L.length === 30 && new Set(L.map(m => m.slot)).size === 30, '列表带 slot，且不重复');
    const { chromium } = require('playwright'); br = await chromium.launch({ executablePath: process.env.WT_CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.wt_lang = 'zh-CN'; localStorage.wt_hollow_lite = '0'; });
    const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message)); await p.goto(B + '/hollow/?lang=zh-CN'); await p.waitForFunction(() => window.__hollow, null, { timeout: 20000 });
    await p.evaluate(() => __hollow.start()); await p.waitForTimeout(3000);
    await p.evaluate(() => __hollow.setPose(0, 1, 0, 0.08)); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(shots, 't281-hall.png') });
    await p.evaluate(() => __hollow.setPose(-3.3, 17.5, 0, 0.1)); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(shots, 't281-portal.png') });
    await p.evaluate(() => __hollow.enter('first')); await p.waitForTimeout(3500);
    ok((await p.evaluate(() => __hollow.lights())) === 30, '30 盏光全部挂上');
    const pos = await p.evaluate(() => __hollow.S.msgs.map(m => __hollow.slotPos(m.slot).join())); ok(new Set(pos).size === 30, '每盏光坐标唯一（确定性挂点）');
    ok(await p.evaluate(() => __hollow.zoneOf(23) === 1 && __hollow.zoneOf(24) === 2), '每区 24 个挂点，24 号起为第 2 区');
    await p.evaluate(() => __hollow.setPose(0, 12, 0, 0.1)); await p.waitForTimeout(1800); await p.screenshot({ path: path.join(shots, 't281-open.png') });
    await p.evaluate(() => __hollow.setPose(0, 36, 0, 0.06)); await p.waitForTimeout(1800); await p.screenshot({ path: path.join(shots, 't281-zone.png') });
    let hit = null; for (const yaw of [Math.PI / 2, -Math.PI / 2]) for (const pt of [0, 0.25, 0.45]) { if (hit) break; await p.evaluate(([y, q]) => __hollow.setPose(0, 47, y, q), [yaw, pt]); await p.waitForTimeout(600); hit = await p.evaluate(() => __hollow.pickLight()); if (hit) break; }
    ok(!!hit, '正对光点可点中（优先命中、扩大点击范围）: ' + hit);
    await p.screenshot({ path: path.join(shots, 't281-zone-side.png') });
    ok(/第 1 区/.test(await p.textContent('#depth')), '区号显示: ' + await p.textContent('#depth'));
    await p.evaluate(() => __hollow.openRead(__hollow.S.msgs[0])); await p.waitForTimeout(1000); ok(/第 \d+ 区/.test(await p.textContent('#pbox')), '读光面板显示区号与编号'); await p.screenshot({ path: path.join(shots, 't281-read.png') });
    await p.evaluate(() => __hollow.setPose(0, 400, 0, 0.06)); await p.waitForTimeout(2500); await p.screenshot({ path: path.join(shots, 't281-deep.png') });
    await p.click('#blite').catch(() => {}); await p.waitForTimeout(1500);
    ok(!errs.length, '无页面 JS 错误 ' + errs.join(' | '));
  } catch (e) { ok(false, 'exception ' + e.stack); }
  finally { await br?.close(); srv.kill(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL OK'); process.exit(fail ? 1 : 0);
})();

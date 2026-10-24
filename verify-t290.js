// t290 树洞：3D 骨骼提灯引路人（GLB + 骨骼动画 + 手持灯笼），精灵兜底
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
    ok((await call('/api/hollow/msg', { ip: '10.4.0.1', body: { door: 'first', text: 'guest try', ...(await cap('10.4.0.1')) } })).j.code === 'hAuth', '访客不能放灯（hAuth）');
    for (let i = 0; i < 3; i++) { const u = { ...(await call('/api/login', { body: { email: 'z' + i + '@test.dev' } })).j, ip: '10.3.' + i + '.1', dev: 'dz' + i };
      await post({ ...u, tok: u.token }, `Lantern ${i + 1}: may everyone I love sleep well tonight.`); }
    const me = { ...(await call('/api/login', { body: { email: 'lan@test.dev' } })).j, ip: '10.5.0.9' };
    const { chromium } = require('playwright'); br = await chromium.launch({ executablePath: process.env.WT_CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true }); const S = n => path.join(shots, 't290-' + n + '.png');
    const mk = async (tok, ip) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'cf-connecting-ip': ip } });
      await ctx.addInitScript(([tok]) => { if (tok) localStorage.wt_token = tok; localStorage.wt_lang = 'en'; localStorage.wt_hollow_lite = '0'; }, [tok]);
      const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); return p; };
    const glbSize = fs.statSync(path.join(pub, 'hollow/npc.vrm')).size; ok(glbSize < 8e6, 'npc.vrm < 8MB: ' + (glbSize / 1024 | 0) + 'KB');
    const p = await mk(me.token, '10.5.0.9'); await p.goto(B + '/hollow/'); await p.waitForFunction(() => window.__hollow, null, { timeout: 20000 });
    await p.evaluate(() => __hollow.start()); await p.waitForTimeout(1500); await p.evaluate(() => __hollow.enter('first'));
    await p.waitForFunction(() => ['glb','vrm'].includes(__hollow.npc().mode), null, { timeout: 30000 }).catch(() => {});
    const n0 = await p.evaluate(() => __hollow.npc()); ok(['glb','vrm'].includes(n0.mode), '加载 3D 骨骼模型（GLB）: ' + n0.mode);
    ok(['walk', 'breath', 'wave', 'give'].every(a => n0.anims.includes(a)), '骨骼动画齐全 walk/breath/wave/give: ' + n0.anims);
    ok(await p.evaluate(() => { let sk = 0; __hollow.npcObj.model.root.traverse(o => { if (o.isSkinnedMesh) sk++; }); return sk > 0; }), '是蒙皮网格（SkinnedMesh），不是精灵'); ok(await p.evaluate(() => !__hollow.npcObj.body.visible), '精灵已隐藏');
    // 走路：玩家远离，指定目标
    await p.evaluate(() => { const n = __hollow.npcObj; n.x = -3; n.s = 10; n.tx = 3.5; n.ts = 13; n.wait = 0; n.yaw = Math.PI / 2; __hollow.setPose(0.5, 3.6, 0, 0.0); });
    await p.waitForTimeout(1200); const w = await p.evaluate(() => __hollow.npc()); ok(w.act === 'walk', '漫步时播放 walk: ' + w.act);
    ok((await p.evaluate(() => __hollow.npc().lanOnHand)), '灯笼挂在左手骨骼上'); const x1 = w.x; await p.waitForTimeout(2500); ok((await p.evaluate(() => __hollow.npc().x)) > x1, '在走动（位置变化）');
    await p.screenshot({ path: S('walking') });
    const fr = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-')); await p.evaluate(() => { const n = __hollow.npcObj; n.x = -3; n.s = 10; n.tx = 3.5; n.ts = 10.5; n.wait = 0; n.yaw = Math.PI / 2; __hollow.setPose(0, 6.2, 0, -0.05); }); await p.waitForTimeout(500);
    for (let i = 0; i < 30; i++) { await p.screenshot({ path: path.join(fr, String(i).padStart(3, '0') + '.png'), clip: { x: 0, y: 200, width: 390, height: 520 } }); await p.waitForTimeout(60); }
    try { cp.execSync(`ffmpeg -y -loglevel error -framerate 8 -i ${fr}/%03d.png -vf "scale=390:-2,format=yuv420p" ${path.join(shots, 't290-walk.mp4')}`); cp.execSync(`ffmpeg -y -loglevel error -framerate 8 -i ${fr}/%03d.png -vf "scale=260:-1:flags=lanczos" ${path.join(shots, 't290-walk.gif')}`); ok(true, '走路短片 t290-walk.mp4/gif'); } catch (e) { ok(false, 'ffmpeg ' + e.message); }
    // 靠近：停下、转向、挥手
    await p.evaluate(() => { const n = __hollow.npcObj; n.x = 0.5; n.s = 9; n.tx = 0.5; n.ts = 9; n.wait = 9; n.yaw = Math.PI / 2; n.near = false; __hollow.setPose(0.3, 2, 0, 0.0); });
    await p.waitForTimeout(500); await p.evaluate(() => __hollow.setPose(0.3, 6.6, 0, 0.0)); await p.waitForTimeout(900);
    const gq = await p.evaluate(() => __hollow.npc()); ok(gq.act === 'wave', '玩家靠近时挥手打招呼: ' + gq.act); ok(Math.abs(((gq.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.6, '转身面向玩家 yaw=' + gq.yaw.toFixed(2));
    await p.screenshot({ path: S('greeting') });
    await p.waitForTimeout(2500); await p.evaluate(() => __hollow.openNpc()); await p.waitForTimeout(150); ok((await p.evaluate(() => __hollow.npc().act)) === 'give', '点"领取灯笼"时递灯动作');
    await p.evaluate(() => document.querySelector('#panel')?.classList.add('t290hide')); await p.addStyleTag({ content: '.t290hide{opacity:.0!important}' }); await p.waitForTimeout(700); await p.screenshot({ path: S('handing') });
    await p.evaluate(() => document.querySelector('#panel')?.classList.remove('t290hide')); await p.waitForTimeout(300); await p.screenshot({ path: S('handing-panel') });
    await p.evaluate(() => document.querySelector('[data-close]')?.click()); await p.waitForTimeout(2500);
    await p.evaluate(() => __hollow.setPose(0.45, 7.6, 0, 0.12)); await p.waitForTimeout(1200); await p.screenshot({ path: S('closeup') });
    ok(p.errs.length === 0, '无页面错误 ' + p.errs.join(' | '));
    // 精灵兜底 & Lite
    const q = await mk(me.token, '10.5.0.9'); await q.goto(B + '/hollow/?npc=sprite'); await q.waitForFunction(() => window.__hollow, null, { timeout: 20000 }); await q.evaluate(() => { __hollow.start(); __hollow.enter('first'); }); await q.waitForTimeout(2500);
    ok(await q.evaluate(() => __hollow.npc().mode === 'sprite' && __hollow.npcObj.body.visible), '兜底：精灵仍可用');
    const L = await mk(me.token, '10.5.0.9'); await L.goto(B + '/hollow/?lite=1'); await L.waitForFunction(() => window.__hollow, null, { timeout: 20000 }); await L.evaluate(() => { __hollow.start(); __hollow.enter('first'); });
    await L.waitForFunction(() => ['glb','vrm'].includes(__hollow.npc().mode), null, { timeout: 30000 }).catch(() => {}); ok(await L.evaluate(() => __hollow.lite && ['glb','vrm'].includes(__hollow.npc().mode) && !__hollow.npcObj.model.pl), 'Lite：3D 模型（无点光源的轻量版）');
    ok(L.errs.length === 0 && q.errs.length === 0, 'Lite/兜底无错误');
  } catch (e) { ok(false, 'exception ' + e.stack); }
  finally { await br?.close(); srv.kill(); console.log(fail ? `\n${fail} FAILED` : '\nALL OK'); process.exit(fail ? 1 : 0); }
})();

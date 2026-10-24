// t289 树洞：提灯 NPC、放飞天灯、访客只读、旧入口重定向（本地测试数据）
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
    for (let i = 0; i < 26; i++) { const u = { ...(await call('/api/login', { body: { email: 'z' + i + '@test.dev' } })).j, ip: '10.3.' + i + '.1', dev: 'dz' + i };
      await post({ ...u, tok: u.token }, `Lantern ${i + 1}: may everyone I love sleep well tonight.`); }
    const me = { ...(await call('/api/login', { body: { email: 'lan@test.dev' } })).j, ip: '10.5.0.9' };
    const { chromium } = require('playwright'); br = await chromium.launch({ executablePath: process.env.WT_CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true }); const S = n => path.join(shots, 't289-' + n + '.png');
    const mk = async (tok, ip) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'cf-connecting-ip': ip } });
      await ctx.addInitScript(([tok]) => { if (tok) localStorage.wt_token = tok; localStorage.wt_lang = 'en'; localStorage.wt_hollow_lite = '0'; }, [tok]);
      const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); return p; };
    // 旧入口重定向
    let p = await mk(null, '10.6.0.1'); await p.goto(B + '/#/treehole'); await p.waitForURL(/\/hollow\/$/, { timeout: 15000 }).catch(() => {}); ok(/\/hollow\/$/.test(p.url()), '#/treehole → /hollow/ ' + p.url());
    await p.waitForTimeout(2500); await p.screenshot({ path: S('redirect') });
    await p.goto(B + '/'); await p.waitForTimeout(2500); const old = await p.evaluate(() => [...document.querySelectorAll('a')].filter(a => a.getAttribute('href') === '#/treehole').length); ok(old === 0, '首页 / 菜单没有旧 #/treehole 链接');
    // 访客
    await p.goto(B + '/hollow/?lang=en'); await p.waitForFunction(() => window.__hollow, null, { timeout: 20000 }); await p.evaluate(() => __hollow.start()); await p.waitForTimeout(2500);
    await p.evaluate(() => __hollow.openDoor('first')); await p.waitForTimeout(1500); const dt = await p.textContent('#pbox');
    ok(/What you can do inside/.test(dt) && /Guests can walk in/.test(dt), '门前英文说明 + 访客提示'); ok(await p.evaluate(() => { const i = document.querySelector('#pbox .inside img'); return i && i.complete && i.naturalWidth > 0; }), '门前说明配图');
    await p.screenshot({ path: S('guest-entry') });
    await p.evaluate(() => __hollow.enter('first')); await p.waitForTimeout(3500); ok((await p.evaluate(() => __hollow.mode)) === 'corr' && (await p.evaluate(() => __hollow.lights())) === 26, '访客可进入 First Light 只读浏览');
    await p.evaluate(() => __hollow.openWrite()); await p.waitForTimeout(600); ok(/Reading only for guests/.test(await p.textContent('#pbox')) && !(await p.$('#hmt')), '访客不能写（提示登录）');
    ok(!p.errs.length, '访客页无 JS 错误 ' + p.errs.join('|')); await p.context().close();
    // 登录用户：NPC → 领灯 → 写 → 放飞
    p = await mk(me.token, me.ip); await p.goto(B + '/hollow/?lang=en'); await p.waitForFunction(() => window.__hollow, null, { timeout: 20000 }); await p.evaluate(() => __hollow.start()); await p.waitForTimeout(2000);
    await p.evaluate(() => __hollow.enter('first')); await p.waitForTimeout(3500);
    const n0 = await p.evaluate(() => __hollow.npc()); ok(n0.vis && n0.x >= -4.01 && n0.x <= 4.01 && n0.s >= 5.9 && n0.s <= 18.1, 'NPC 在入口区固定范围内 ' + JSON.stringify(n0));
    await p.waitForTimeout(4000); const n1 = await p.evaluate(() => __hollow.npc()); ok(n1.x >= -4.01 && n1.x <= 4.01 && n1.s >= 5.9 && n1.s <= 18.1, 'NPC 漫步不越界 ' + JSON.stringify(n1));
    await p.evaluate(n => __hollow.setPose(n.x + 0.3, n.s - 2.6, 0, -0.05), n1); await p.waitForTimeout(1200); ok((await p.evaluate(() => __hollow.npc().near)) && await p.isVisible('#bnpc'), '靠近 NPC 出现 Take a lantern');
    await p.screenshot({ path: S('npc') });
    await p.click('#bnpc'); await p.waitForTimeout(600); ok(/Seeking kindred souls/.test(await p.textContent('#pbox')), 'NPC 提示 Seeking kindred souls…');
    await p.click('[data-lantern]'); await p.waitForTimeout(1200); ok(/Write on your lantern/.test(await p.textContent('#pbox')) && await p.getAttribute('#hmt', 'maxlength') === '200', '写灯面板（200 字）');
    await p.fill('#hmt', 'May my grandmother feel how much I still love her, wherever the stars carry her tonight.'); const q = (await p.textContent('#hcap')).match(/\d+/g).map(Number); await p.fill('#hans', String(q[0] + q[1]));
    await p.screenshot({ path: S('write') });
    await p.click('[data-send]'); await p.waitForTimeout(1800); await p.screenshot({ path: S('release') }); ok(await p.evaluate(() => !!__hollow.S.releasing), '放飞动画进行中');
    await p.waitForTimeout(6500); const ht = await p.textContent('#pbox').catch(() => ''); ok(/Your light hangs in First Light, Zone 2/.test(ht), '放飞后提示所在分区: ' + ht.slice(0, 60));
    const mine = await p.evaluate(() => __hollow.S.msgs[0]); ok(mine.slot === 26, '放飞的灯分到固定 slot ' + mine.slot);
    await p.screenshot({ path: S('hangs') });
    await p.click('[data-fly]'); await p.waitForTimeout(2500); const hit = await p.evaluate(() => __hollow.pickLight()); ok(hit === mine.id, '飞到我的灯，并能点中它 ' + hit);
    await p.screenshot({ path: S('fly') });
    await p.evaluate(() => __hollow.setPose(0, 40, 0, 0.55)); await p.waitForTimeout(2500); await p.screenshot({ path: S('lantern-sky') });
    ok(await p.evaluate(() => __hollow.skyN >= 300), '满天天灯（实例化）');
    await p.evaluate(() => __hollow.setPose(0, 36, 0, 0.3)); await p.waitForTimeout(2000); await p.screenshot({ path: S('inside-src') });
    ok(!p.errs.length, '无 JS 错误 ' + p.errs.join(' | ')); await p.context().close();
    p = await mk(null, '10.6.0.2'); await p.goto(B + '/hollow/?lang=en&lite=1'); await p.waitForFunction(() => window.__hollow, null, { timeout: 20000 }); await p.evaluate(() => { __hollow.start(); __hollow.enter('first'); }); await p.waitForTimeout(3500);
    ok(await p.evaluate(() => __hollow.lite && __hollow.skyN < 500) && !p.errs.length, 'Lite 模式：天灯数量降低，无错误'); await p.context().close();
  } catch (e) { ok(false, 'exception ' + e.stack); }
  finally { await br?.close(); srv.kill(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL OK'); process.exit(fail ? 1 : 0);
})();

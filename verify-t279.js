// t279 树洞 v1 验证：静态检查 + 后端 API（临时目录、模拟统计、不上链）+ 390px 页面截图（本地测试数据，带 LOCAL TEST DATA 标记）
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const pub = path.join(__dirname, 'public'), LANGS = 'zh-CN zh-TW en ja ko es fr de pt ru ar hi id vi th tr it nl pl uk fa bn ur fil ms sw'.split(' ');
console.log('static');
const H = require('./hollow');
ok(H.DOORS.length === 10 && H.OPEN.join() === 'first,sea', '10 扇门，v1 仅开放 First Light / Sea of Wisdom');
ok(H.NEED.wishes === 3 && H.NEED.gave === 5 && H.NEED.got === 3, 'Sea 解锁条件 3 / 5 / 3');
for (const d of H.DOORS) ok(fs.statSync(path.join(pub, 'hollow/doors', d + '.webp')).size < 120000, 'door art ' + d + ' < 120KB');
const en = JSON.parse(fs.readFileSync(path.join(pub, 'i18n/en.json'))), hk = Object.keys(en).filter(k => k.startsWith('hollow.'));
ok(hk.length >= 80, 'hollow.* keys: ' + hk.length);
for (const l of LANGS) { const d = JSON.parse(fs.readFileSync(path.join(pub, 'i18n', l + '.json'))); ok(hk.every(k => typeof d[k] === 'string' && d[k] && (en[k].match(/\{\w+\}/g) || []).every(ph => d[k].includes(ph))), l + ': all hollow keys + placeholders'); }
const allTxt = LANGS.map(l => hk.map(k => JSON.parse(fs.readFileSync(path.join(pub, 'i18n', l + '.json')))[k]).join('\n')).join('\n') + fs.readFileSync(path.join(pub, 'hollow/hollow.js'), 'utf8') + fs.readFileSync(path.join(pub, 'hollow/index.html'), 'utf8');
ok(!/还愿/.test(allTxt), '无「还愿」'); ok(!/\b(yield|airdrop|revenue|gas included|forever private|always secret)\b/i.test(allTxt), '无收益 / 空投 / gas 包含 / 永久保密承诺');
ok(!/[\u4e00-\u9fff]/.test(fs.readFileSync(path.join(pub, 'hollow/hollow.js'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'hollow.js 无硬编码中文（深度文案走 i18n）');
ok(H.CARE.test('I want to kill myself') && H.CARE.test('我想自杀') && !H.CARE.test('I miss my grandma'), '自伤关注识别');
ok(H.people([{ id: 'a', keys: ['i:1'] }, { id: 'b', keys: ['i:1'] }, { id: 'c', keys: ['d:9'] }, { id: 'm', keys: ['i:me'] }], new Set(['i:me'])) === 2, '同 IP / 设备合并为同一人，与自己共享的不计');
const sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8'); ok(/\/hollow\\\/\?/.test(sw), 'SW：/hollow/ 导航不覆盖首页缓存');
ok(/href="\/hollow\/"/.test(fs.readFileSync(path.join(pub, 'index.html'), 'utf8')) && /\/hollow\//.test(fs.readFileSync(path.join(pub, 'app.js'), 'utf8')), '首页 / 菜单入口');
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
    const U = {}; for (const n of 'abcdefghij') U[n] = { ...(await call('/api/login', { body: { email: n + '@test.dev' } })).j, ip: '10.1.0.' + n.charCodeAt(0), dev: 'dev-' + n };
    ok(Object.values(U).every(u => u.token), '10 个测试账户登录（本地临时库）');
    let r = await call('/api/hollow/state'); ok(r.s === 200 && !r.j.login && r.j.offchain === true && r.j.doors.length === 10, 'state：未登录可看，标注 off-chain');
    ok((await call('/api/hollow/claim', { body: { card: 'first' } })).s === 401, '未登录领卡 401');
    r = await call('/api/hollow/claim', { ...U.a, tok: U.a.token, body: { card: 'first' } }); ok(r.s === 200 && r.j.cards.includes('first'), 'First Light 免费领取');
    ok((await call('/api/hollow/claim', { ...U.a, tok: U.a.token, body: { card: 'phoenix' } })).s === 400, '其他门 Coming soon 不可领');
    mock({ [U.a.pubkey]: { wishes: 1 } }); ok((await call('/api/hollow/claim', { ...U.a, tok: U.a.token, body: { card: 'sea' } })).s === 403, 'Sea 条件未满 403');
    ok((await call('/api/hollow/msg', { ...U.b, body: { text: 'hi', cid: '1.2.3', ans: 1 } })).j.code === 'hAuth', '访客不能留言（只读）');
    ok((await call('/api/hollow/msg', { ...U.b, tok: U.b.token, body: { text: 'hi', cid: '1.2.3', ans: 1 } })).j.code === 'freeCaptcha', '留言需验证码');
    r = await post({ ...U.b, tok: U.b.token }, '<b>x</b>'); ok(r.j.code === 'len', '拒绝 HTML');
    r = await post({ ...U.b, tok: U.b.token }, 'x'.repeat(201)); ok(r.j.code === 'len', '超长拒绝');
    r = await post({ ...U.b, tok: U.b.token }, 'Sometimes I just want someone to say: you did fine today.'); ok(r.s === 200 && /^HM_[0-9a-f]{12}$/.test(r.j.item.id) && !('acct' in r.j.item) && !('ip' in r.j.item), '留言成功，公开字段不含作者 / IP');
    const mB = r.j.item.id;
    ok((await post({ ...U.b, tok: U.b.token }, 'second one')).j.code === 'hUsed', '同一人终身 1 条');
    ok((await post({ ip: U.b.ip, dev: 'other', tok: U.i.token }, 'same ip new device')).j.code === 'hUsed', '同 IP 换设备仍算已用');
    ok((await post({ ip: '10.9.9.9', dev: U.b.dev, tok: U.j.token }, 'same device new ip')).j.code === 'hUsed', '同设备换 IP 仍算已用');
    r = await post({ ...U.c, tok: U.c.token }, 'I want to kill myself'); ok(r.j.care === true, '自伤内容 → care 提示（' + (r.s === 200 ? '通过审核' : '被审核拒绝 ' + r.j.code) + '）');
    if (r.s !== 200) ok((await post({ ...U.c, tok: U.c.token }, 'Grandma, I still keep your recipe book by the window.')).s === 200, '被拒不占用名额');
    const ids = { b: mB }; for (const n of 'defg') { r = await post({ ...U[n], tok: U[n].token }, `Light from ${n}: the rain sounded kind tonight.`); ids[n] = r.j.item?.id; }
    ok(Object.values(ids).every(Boolean), '多人留言');
    r = await call('/api/hollow/light', { ...U.a, tok: U.a.token, body: { id: mB } }); ok(r.j.n === 1 && !r.j.dup, '点亮 I heard you');
    r = await call('/api/hollow/light', { ...U.a, tok: U.a.token, body: { id: mB } }); ok(r.j.dup && r.j.n === 1, '重复点亮不计');
    r = await call('/api/hollow/light', { ip: U.a.ip, dev: 'x2', body: { id: mB } }); ok(r.j.n === 1, '同 IP 匿名再点也不计');
    ok((await call('/api/hollow/light', { ...U.b, tok: U.b.token, body: { id: mB } })).j.own, '不能点亮自己');
    for (const n of 'defg') await call('/api/hollow/light', { ...U.a, tok: U.a.token, body: { id: ids[n] } });
    r = await call('/api/hollow/state', { ...U.a, tok: U.a.token }); ok(r.j.sea.gave === 5 && r.j.sea.wishes === 1, 'A 点亮了 5 个不同的人（' + r.j.sea.gave + '）');
    // A 也留一条，让 3 个人点亮；其中 h、i 与 j 共享 IP → 只算 2 人
    r = await post({ ...U.a, tok: U.a.token }, 'Thank you, whoever planted this tree.'); const mA = r.j.item.id;
    await call('/api/hollow/light', { ...U.h, tok: U.h.token, body: { id: mA } }); await call('/api/hollow/light', { ...U.i, ip: '10.7.7.7', tok: U.i.token, body: { id: mA } }); await call('/api/hollow/light', { ...U.j, ip: '10.7.7.7', tok: U.j.token, body: { id: mA } });
    r = await call('/api/hollow/state', { ...U.a, tok: U.a.token }); ok(r.j.sea.got === 2, '同 IP 的两个账号合并为一人（got=' + r.j.sea.got + '）');
    await call('/api/hollow/light', { ...U.c, tok: U.c.token, body: { id: mA } });
    r = await call('/api/hollow/state', { ...U.a, tok: U.a.token }); ok(r.j.sea.got === 3 && !r.j.sea.done && !r.j.cards.includes('sea'), 'got=3，但链上心愿 1/3 → 未解锁');
    mock({ [U.a.pubkey]: { wishes: 3 } }); r = await call('/api/hollow/state', { ...U.a, tok: U.a.token }); ok(r.j.sea.done && r.j.cards.includes('sea') && r.j.seaNew, '3 个链上心愿 → 自动授予 Sea of Wisdom');
    r = await call('/api/report', { ...U.d, tok: U.d.token, body: { sig: mB, reason: 'other' } }); ok(r.s === 200, '举报接口接受 HM_ id（' + r.s + ' ' + (r.j.code || r.j.ok || '') + '）');
    r = await call('/api/hollow/msgs?door=first'); ok(r.j.items.length >= 6 && r.j.items.every(m => !m.acct && !m.ip && !m.dev), '列表匿名');
    // ---- UI（390px）----
    const { chromium } = require('playwright'); br = await chromium.launch({ executablePath: process.env.WT_CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
    const page = async (u, lang = 'en') => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'cf-connecting-ip': u ? u.ip : '10.5.5.5' } });
      await ctx.addInitScript(([tok, dev, lang]) => { if (tok) localStorage.wt_token = tok; localStorage.wt_dev = dev; localStorage.wt_lang = lang; if (!localStorage.wt_hollow_lite) localStorage.wt_hollow_lite = '0'; }, [u?.token || '', u?.dev || 'dev-ui', lang]);
      const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs; await p.goto(B + '/hollow/?lang=' + lang); await p.waitForFunction(() => window.__hollow, null, { timeout: 20000 }); await p.waitForTimeout(2500); return p; };
    let p = await page(null); ok(await p.isVisible('#bstart') && await p.isVisible('#mocklbl'), 'intro + LOCAL TEST DATA 标记');
    await p.evaluate(() => { __hollow.start(); }); await p.waitForTimeout(3000); ok((await p.evaluate(() => __hollow.mode)) === 'hall', '门厅');
    await p.screenshot({ path: path.join(shots, 't279-hall.png') });
    ok(await p.evaluate(() => typeof __hollow.xr() === 'boolean') && await p.isHidden('#bvr').catch(() => true), 'WebXR 按钮仅在支持时显示');
    await p.evaluate(() => __hollow.openDoor('phoenix')); await p.waitForTimeout(500); ok(/soon/i.test(await p.textContent('#pbox')), '其他门 Coming soon');
    await p.evaluate(() => __hollow.enter('first')); await p.waitForTimeout(3500); ok((await p.evaluate(() => __hollow.mode)) === 'corr', '进入 First Light 走廊');
    const nl = await p.evaluate(() => __hollow.lights()); ok(nl >= 6, '走廊墙上的光点 ' + nl);
    await p.evaluate(() => __hollow.setPose(0, 26, 0)); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(shots, 't279-corridor.png') });
    await p.evaluate(() => __hollow.openRead(__hollow.S.msgs.find(m => /Sometimes/.test(m.text)) || __hollow.S.msgs[0])); await p.waitForTimeout(1500);
    ok(/heard/i.test(await p.textContent('#pbox')) && /report/i.test(await p.textContent('#pbox')), '读光：I heard you + 举报');
    await p.screenshot({ path: path.join(shots, 't279-read.png') });
    ok(!p.errs.length, '无页面 JS 错误 ' + p.errs.join(' | ')); await p.context().close();
    p = await page(U.e); await p.evaluate(() => __hollow.start()); await p.evaluate(() => __hollow.enter('first')); await p.waitForTimeout(3000);
    await p.evaluate(() => __hollow.openWrite()); await p.waitForTimeout(1200); await p.fill('#pbox textarea', 'Whoever reads this: you are not as alone as tonight feels.'); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(shots, 't279-write.png') }); ok(await p.isVisible('#pbox textarea'), '写留言面板（本地测试数据，不提交到线上）'); await p.context().close();
    mock({ [U.f.pubkey]: { wishes: 2 } }); await call('/api/hollow/light', { ...U.f, tok: U.f.token, body: { id: ids.d } }); await call('/api/hollow/light', { ...U.f, tok: U.f.token, body: { id: ids.g } });
    await call('/api/hollow/light', { ...U.h, tok: U.h.token, body: { id: ids.f } });
    p = await page(U.f); await p.evaluate(() => __hollow.start()); await p.waitForTimeout(2000); await p.evaluate(() => __hollow.openDoor('sea')); await p.waitForTimeout(1200);
    const sp = await p.textContent('#seaprog').catch(() => ''); ok(/2\s*\/\s*3[\s\S]*2\s*\/\s*5[\s\S]*2\s*\/\s*3/.test(sp), 'Sea 进度面板 2/3 · 2/5 · 2/3');
    await p.screenshot({ path: path.join(shots, 't279-sea.png') }); await p.context().close();
    p = await page(null, 'ar'); ok((await p.evaluate(() => document.documentElement.dir)) === 'rtl', 'ar RTL'); await p.context().close();
    p = await page(null, 'zh-CN'); const l0 = await p.evaluate(() => __hollow.lite); await p.click('#blite'); await p.waitForTimeout(500); ok(await p.evaluate(l0 => __hollow.lite === !l0 && localStorage.wt_hollow_lite === (l0 ? '0' : '1'), l0), 'Lite 模式切换'); ok(!p.errs.length, 'zh-CN 无 JS 错误'); await p.context().close();
  } catch (e) { ok(false, 'exception ' + e.stack); }
  finally { await br?.close(); srv.kill(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL OK'); process.exit(fail ? 1 : 0);
})();

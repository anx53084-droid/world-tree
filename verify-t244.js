// t244：官方示范（仅管理员）/ 免费心愿（未上链、验证码、限流、审核、升级认领）/ 点亮 + 站内信 / 举报队列 + 隐藏 / og-meta / SEO 文件 / 新页面。模拟数据，不发真实交易，不写生产。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), crypto = require('crypto'), nacl = require('tweetnacl'), bs58 = require('bs58');
const b58 = bs58.default || bs58; let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS;
(async () => {
  const P = f => fs.readFileSync(path.join(D, 'public', f), 'utf8');
  ok(/Disallow: \/api\//.test(P('robots.txt')) && /Sitemap: https:\/\/guangqi\.world\/sitemap\.xml/.test(P('robots.txt')), 'robots.txt：屏蔽 /api/，指向 sitemap');
  ok((P('sitemap.xml').match(/hreflang=/g) || []).length >= 16, 'sitemap.xml：16 语言 hreflang');
  ok(/cardPage/.test(fs.readFileSync(D + '/functions/_middleware.js', 'utf8')) && /og-meta/.test(fs.readFileSync(D + '/functions/_middleware.js', 'utf8')), '中间件：/c/<id> 卡片 OG');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-244-')), port = 18991, Bs = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data', { recursive: true });
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', PRICE_MOCK: '1' }, stdio: 'ignore' });
  const wr = (f, o) => fs.writeFileSync(path.join(tmp, 'data', f), JSON.stringify(o));
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); const t = await x.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { s: x.status, j }; };
  const wlogin = async () => { const kp = nacl.sign.keyPair(), a = b58.encode(kp.publicKey), nonce = (await call('/api/nonce')).j.nonce;
    const m = `${host} wants you to sign in with your Solana account:\n${a}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    const r = (await call('/api/login/wallet', { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) })).j; assert(r.token); return { token: r.token, pubkey: a }; };
  const fsig = () => b58.encode(crypto.randomBytes(64)), IP = i => ({ 'x-forwarded-for': '10.9.0.' + i }), ADM = { 'x-admin-key': 'k-test' };
  const solve = async (h) => { const c = (await call('/api/free/challenge', null, h)).j, [a, b] = c.q.match(/\d+/g).map(Number); return { cid: c.cid, ans: a + b, bad: a + b + 1 }; };
  let browser; try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const A = await wlogin(), V = await wlogin(), tk = u => ({ authorization: 'Bearer ' + u.token });
    // 官方示范：仅管理员
    ok((await call('/api/admin/samples', { text: '示范', cat: '风景' })).s === 403 && (await call('/api/admin/samples', { text: '示范', cat: '风景' }, { 'x-admin-key': 'wrong' })).s === 403, '示范：无 / 错 ADMIN_KEY → 403');
    const sm = await call('/api/admin/samples', { text: '希望明年春天能和家人一起去看一次樱花。', cat: '风景' }, ADM); ok(sm.s === 200 && /^OS_[0-9a-f]{12}$/.test(sm.j.id), '示范：管理员添加');
    ok((await call('/api/admin/samples', { text: 'a|b', cat: '风景' }, ADM)).s === 400, '示范：非法字符被拒');
    let off = (await call('/api/offchain')).j; ok(off.samples.some(s => s.id === sm.j.id && s.cat === '风景'), '/api/offchain 含示范');
    // 免费心愿
    let c = await solve(IP(1)); ok((await call('/api/free', { text: '想学会弹一首吉他曲', cat: '卡通', cid: c.cid, ans: c.bad, dev: 'd1' }, IP(1))).j.code === 'freeCaptcha', '免费：验证码错误被拒');
    c = await solve(IP(1)); const fr = await call('/api/free', { text: '想学会弹一首吉他曲', cat: '卡通', cid: c.cid, ans: c.ans, dev: 'd1' }, IP(1));
    ok(fr.s === 200 && /^OF_/.test(fr.j.id) && fr.j.token.length > 20, '免费：通过 → id + 浏览器令牌');
    ok((await call('/api/free', { text: '再来一次', cat: '卡通', cid: c.cid, ans: c.ans, dev: 'd1' }, IP(1))).j.code === 'freeCaptcha', '免费：验证码一次性');
    c = await solve(IP(2)); ok((await call('/api/free', { text: '我想自杀', cid: c.cid, ans: c.ans, dev: 'd2' }, IP(2))).j.code === 'reject', '免费：审核拒绝负面内容');
    c = await solve(IP(2)); ok((await call('/api/free', { text: 'x'.repeat(141), cid: c.cid, ans: c.ans, dev: 'd2' }, IP(2))).j.code === 'len', '免费：超 140 字被拒');
    for (let i = 0; i < 2; i++) { c = await solve(IP(1)); assert((await call('/api/free', { text: '心愿' + i, cid: c.cid, ans: c.ans, dev: 'd1x' + i }, IP(1))).s === 200); }
    c = await solve(IP(1)); ok((await call('/api/free', { text: '第四条', cid: c.cid, ans: c.ans, dev: 'd9' }, IP(1))).j.code === 'freeRate', '免费：同一 IP 每天 3 条');
    for (let i = 0; i < 3; i++) { c = await solve(IP(20 + i)); assert((await call('/api/free', { text: '设备' + i, cid: c.cid, ans: c.ans, dev: 'DEV' }, IP(20 + i))).s === 200); }
    c = await solve(IP(30)); ok((await call('/api/free', { text: '设备4', cid: c.cid, ans: c.ans, dev: 'DEV' }, IP(30))).j.code === 'freeRate', '免费：同一设备每天 3 条');
    off = (await call('/api/offchain')).j; ok(off.free.some(f => f.id === fr.j.id) && !JSON.stringify(off).includes('tok') && !JSON.stringify(off).includes('"ip"'), '/api/offchain 含免费心愿，不泄露令牌哈希 / IP');
    // 认领升级
    const mo = (await call('/api/moderate', { text: '想学会弹一首吉他曲', prefix: '卡通' })).j, a = mo.attestation, sigU = fsig(), sigX = fsig();
    wr('tx-mock.json', { [sigU]: { author: A.pubkey, memo: `WTREE1|W|${a.hash}|${a.ts}|${a.sig}|卡通|想学会弹一首吉他曲` }, [sigX]: { author: V.pubkey, memo: `WTREE1|W|${a.hash}|${a.ts}|${a.sig}|卡通|想学会弹一首吉他曲` } });
    ok((await call('/api/free/claim', { id: fr.j.id, token: fr.j.token, sig: sigU })).s === 401, '认领：需登录');
    ok((await call('/api/free/claim', { id: fr.j.id, token: 'bad', sig: sigU }, tk(A))).s === 403, '认领：令牌错误 → 403');
    ok((await call('/api/free/claim', { id: fr.j.id, token: fr.j.token, sig: sigX }, tk(A))).j.code === 'freeVerify', '认领：交易非本人钱包 → 拒绝');
    ok((await call('/api/free/claim', { id: fr.j.id, token: fr.j.token, sig: sigU }, tk(A))).j.ok, '认领：本人钱包 + 正文一致 → 已上链');
    ok(!(await call('/api/offchain')).j.free.some(f => f.id === fr.j.id), '认领后从「未上链」列表移除');
    // 点亮 + 站内信
    let ch = await call('/api/cheer', { sig: sigU }, { ...tk(V), ...IP(5) }); ok(ch.j.n === 1, '点亮：计数 +1');
    ch = await call('/api/cheer', { sig: sigU }, { ...tk(V), ...IP(5) }); ok(ch.j.dup && ch.j.n === 1, '点亮：同一人同卡每天一次');
    ok((await call('/api/cheer', { sig: sm.j.id }, IP(6))).j.n === 1, '点亮：示范卡可点亮（无需登录）');
    await new Promise(r => setTimeout(r, 800)); const ib = (await call('/api/inbox', null, tk(A))).j.items || []; ok(ib.some(m => m.kind === 'cheer' && m.sig === sigU && m.n === 1), '点亮：卡主收到站内信');
    ok((await call('/api/offchain')).j.cheers[sigU] === 1, '/api/offchain 含点亮计数');
    // 举报 → 管理队列 → 隐藏
    ok((await call('/api/report', { sig: sigU, reason: 'evil' }, IP(7))).s === 400, '举报：非法理由被拒');
    ok((await call('/api/report', { sig: sigU, reason: 'spam', note: '刷屏' }, IP(7))).j.ok, '举报：提交');
    ok((await call('/api/report', { sig: sigU, reason: 'spam' }, IP(7))).s === 429, '举报：同 IP 同卡每天一次');
    ok((await call('/api/admin/reports')).s === 403, '举报队列：非管理员 403');
    const q = (await call('/api/admin/reports', null, ADM)).j; ok(q.open.length === 1 && q.open[0].sig === sigU && !('by' in q.open[0] && q.open[0].by.length > 20), '举报队列：管理员可见');
    ok((await call('/api/admin/reports/resolve', { id: q.open[0].id, action: 'hide' }, ADM)).j.ok, '管理员：隐藏');
    ok((await call('/api/offchain')).j.hidden.includes(sigU) && (await call('/api/og-meta/' + sigU)).s === 404, '隐藏后：hidden 列表 + og-meta 404');
    // og-meta
    const om = (await call('/api/og-meta/' + sm.j.id)).j; ok(om.official && om.text.includes('樱花'), 'og-meta：示范卡');
    ok((await call('/api/og-meta/OF_000000000000')).s === 404 && (await call('/api/og-meta/<x>')).s === 400, 'og-meta：不存在 / 非法 id');
    { const ps = fsig(), mp = (await call('/api/moderate', { text: '秘密心愿', prefix: '经典~vR' })).j.attestation; wr('tx-mock.json', { [ps]: { author: A.pubkey, memo: `WTREE1|W|${mp.hash}|${mp.ts}|${mp.sig}|经典~vR|秘密心愿` } });
      const r = await call('/api/og-meta/' + ps); ok(r.s === 404 || !r.j.text, 'og-meta：非公开卡不泄露正文'); }
    if (!SHOTS) { console.log(`\n✅ ${n} checks passed`); return; }
    // 截图
    const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const errs = [];
    const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, locale: 'zh-CN' }); const p = await ctx.newPage(); p.on('pageerror', e => { errs.push(e.message); console.log('ERR', e.message); });
    const shot = async (name) => { await p.waitForTimeout(600); await p.screenshot({ path: SHOTS + '/t244-' + name + '.png' }); };
    await p.goto(Bs + '/?lang=zh-CN'); await p.evaluate(() => { localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; });
    await p.goto(Bs + '/?lang=zh-CN#/free'); await p.reload(); await p.waitForSelector('#ftext', { timeout: 60000 }); await p.waitForFunction(() => /\d \+ \d/.test(document.querySelector('#fq').textContent));
    const qq = await p.textContent('#fq'), [x1, x2] = qq.match(/\d+/g).map(Number); await p.fill('#ftext', '希望和多年没见的老同学重新聚一次'); await p.fill('#fans', String(x1 + x2)); await shot('free-page');
    await p.click('#fsub'); await p.waitForSelector('#fmine [data-upfree]', { timeout: 15000 }); ok(true, '页面：免费心愿提交成功，出现在「我的免费心愿」'); await p.locator('#fmine').scrollIntoViewIfNeeded(); await shot('free-mine');
    const fid = await p.$eval('#fmine [data-upfree]', b => b.dataset.upfree);
    await p.goto(Bs + '/?lang=zh-CN#/'); await p.waitForFunction(id => typeof S !== "undefined" && S.wishes?.some(w => w.sig === id), fid, { timeout: 90000 });
    const jt = async sig => p.evaluate(s => { WT3D.update(treeWishes().map(lockPaint), openCardPopup, { stress: S.stress, total: S.total }); const w = S.wishes.find(x => x.sig === s); return WT3D.jumpTo(w.id).then(r => !!r); }, sig);
    await p.waitForTimeout(3000); ok(await jt(fid), '树上：免费心愿挂上树'); await p.waitForTimeout(4000); await shot('tree-free');
    ok(await jt(sm.j.id), '树上：官方示范挂上树'); await p.waitForTimeout(4000); await shot('tree-official');
    await p.goto(Bs + '/?lang=zh-CN#/w/' + fid); await p.waitForSelector('.t-offchain', { timeout: 20000 }); ok(await p.isVisible('.off-note'), '详情：未上链标识 + 非永久说明'); await shot('free-detail');
    await p.click('[data-cheer]'); await p.waitForSelector('button.cheer.lit', { timeout: 10000 }); ok((await p.textContent('button.cheer.lit')).includes('1'), '详情：点亮计数显示'); await shot('cheer');
    await p.goto(Bs + '/?lang=zh-CN#/w/' + sm.j.id); await p.waitForSelector('.t-official', { timeout: 20000 }); ok(true, '详情：官方示范标识'); await shot('official-detail');
    await p.click('#share'); await p.waitForSelector('#cp', { timeout: 10000 }); ok((await p.content()).includes('/c/' + sm.j.id), '分享：链接为 /c/<id>'); await shot('share');
    await p.evaluate(() => closeModal()); await p.click('[data-report]'); await p.waitForSelector('#rpr'); await shot('report');
    await p.selectOption('#rpr', 'other'); await p.click('#rps'); await p.waitForTimeout(800);
    ok((await call('/api/admin/reports', null, ADM)).j.open.some(r => r.sig === sm.j.id), '页面举报 → 管理员队列');
    await p.goto(Bs + '/?lang=zh-CN#/wallet-guide'); await p.waitForSelector('.wg-steps li'); ok((await p.$$('.wg-steps li')).length === 5 && (await p.content()).includes('phantom.com/download'), '钱包教程：5 步 + 官方链接'); await shot('wallet-guide');
    await p.goto(Bs + '/?lang=zh-CN#/rules'); await p.waitForTimeout(800); ok((await p.content()).includes('24–72'), '规则页：审核标准 + 处理时限'); await shot('rules');
    await p.goto(Bs + '/?lang=zh-CN#/inbox'); await p.waitForTimeout(1200); await shot('empty-inbox');
    await p.goto(Bs + '/?lang=en#/rules'); await p.reload(); await p.waitForTimeout(1200); ok((await p.content()).includes('Moderation rules'), '英文规则页'); await shot('rules-en');
    ok(!errs.length, '无页面错误');
    console.log(`\n✅ ${n} checks passed`);
  } finally { if (browser) await browser.close(); srv.kill(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

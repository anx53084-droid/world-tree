// t252：朋友代付——24 小时一次性链接、官方收款地址标注与防骗提示、朋友自己钱包签名（测试中模拟钱包与 RPC，不发真实交易）、服务器链上核验（ADS_MOCK_PAY 模拟交易）、作者站内信、过期/已用提示。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), nacl = require('tweetnacl'), b58 = require('bs58').default || require('bs58'), crypto = require('crypto');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS, PFX = SHOTS ? SHOTS + '/t252-' : '';
(async () => { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-252-')), port = 18997, Bs = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port; let browser;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', PRICE_MOCK: '1' }, stdio: 'ignore' });
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await x.json(); } catch {} return { s: x.status, j }; };
  try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const wlogin = async () => { const kp = nacl.sign.keyPair(), a = b58.encode(kp.publicKey), nonce = (await call('/api/nonce')).j.nonce;
      const m = `${host} wants you to sign in with your Solana account:\n${a}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const r = (await call('/api/login/wallet', { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) })).j; assert(r.token); return { token: r.token, pubkey: a }; };
    const A = await wlogin(), F = await wlogin(), tk = u => ({ authorization: 'Bearer ' + u.token }), cfg = (await call('/api/config')).j, text = '希望奶奶的腿快点好起来，春天能一起去公园散步。';
    const att = (await call('/api/moderate', { text, prefix: '经典' })).j.attestation, memo = `WTREE1|W|${att.hash}|${att.ts}|${att.sig}|经典|${text}`, lam = cfg.minLamports;
    ok((await call('/api/fpay', { memo, lamports: lam })).s === 401, '生成链接：需要作者登录');
    ok((await call('/api/fpay', { memo: memo.replace('奶奶', '爷爷'), lamports: lam }, tk(A))).j.code === 'fpMemo', '生成链接：篡改过的心愿 memo 被拒');
    ok((await call('/api/fpay', { memo, lamports: Math.floor(lam / 3) }, tk(A))).j.code === 'fpAmount', '生成链接：金额低于最低值被拒');
    const L = (await call('/api/fpay', { memo, lamports: lam }, tk(A))).j; ok(/^[0-9a-f]{16}$/.test(L.id) && Math.abs(L.exp - Date.now() - 864e5) < 6e4 && L.path === '/#/fpay/' + L.id, '生成链接：24 小时有效');
    const g = (await call('/api/fpay/' + L.id)).j; ok(g.state === 'open' && g.text === text && g.receive === cfg.receive && g.author === A.pubkey && g.tag === `WTFP1|${L.id}|${A.pubkey}|`, '付款页数据：心愿、金额、官方收款地址');
    const mock = {}, sig = () => b58.encode(crypto.randomBytes(64)), wm = () => fs.writeFileSync(tmp + '/data/tx-mock.json', JSON.stringify(mock)), now = Math.floor(Date.now() / 1000);
    const S1 = sig(), S2 = sig(), S3 = sig(), S4 = sig(); mock[S1] = { payer: F.pubkey, blockTime: now, memos: [memo], paid: lam }; mock[S2] = { payer: F.pubkey, blockTime: now, memos: [memo, g.tag + '小林'], paid: lam - 1000 }; mock[S3] = { payer: F.pubkey, blockTime: now, memos: [memo, g.tag + '小林'], paid: lam }; mock[S4] = { ...mock[S3] }; wm();
    ok((await call(`/api/fpay/${L.id}/confirm`, { sig: S1 })).j.code === 'fpVerify', '核验：缺少代付标记 → 拒绝');
    ok((await call(`/api/fpay/${L.id}/confirm`, { sig: S2 })).j.code === 'fpVerify', '核验：转入官方地址金额不足 → 拒绝');
    // 浏览器：付款页（访客 → 提示连接钱包；朋友钱包 → 签名付款）
    const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const errs = [];
    const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'zh-CN' }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(Bs + '/?lang=zh-CN'); await p.evaluate(() => { localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }); await p.goto(Bs + '/?lang=zh-CN#/fpay/' + L.id); await p.waitForSelector('.fp-card', { timeout: 30000 });
    const CR = cfg.receive, [pg, rc] = await p.evaluate(() => [document.querySelector('#fpbox').innerText, document.querySelector('.fp-recv code').textContent]); ok(pg.includes('希望奶奶') && /官方收款地址/.test(pg) && rc === CR && /私下/.test(pg) && /SOL/.test(pg), '付款页：心愿内容、金额、标注「官方」的收款地址、防骗提示');
    ok(/连接你自己的钱包/.test(pg) && !(await p.$('#fpgo')), '访客：需先连接自己的钱包');
    // 模拟朋友已用自己的 Solana 钱包登录：钱包签名 → 返回 S3；RPC 请求由测试拦截（不发真实交易）
    await p.route(/fake-rpc/, async r => { const b = JSON.parse(r.request().postData() || '{}'), one = x => ({ jsonrpc: '2.0', id: x.id, result: x.method === 'getLatestBlockhash' ? { context: { slot: 1 }, value: { blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k', lastValidBlockHeight: 999999 } } : x.method === 'getSignatureStatuses' ? { context: { slot: 2 }, value: [{ slot: 2, confirmations: 1, err: null, confirmationStatus: 'confirmed' }] } : x.method === 'getBlockHeight' ? 10 : null });
      await r.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(b) ? b.map(one) : one(b)) }); });
    await p.evaluate(([pk, s3, u]) => { RPC_WRITE = u; S.mode = 'self'; S.pubkey = pk; S.wallet = { signAndSend: async tx => { window.__fpTx = tx.instructions.map(i => i.programId.toBase58() + ':' + new TextDecoder().decode(i.data)); window.__fpPayer = tx.feePayer.toBase58(); return s3; } }; route(); }, [F.pubkey, S3, Bs + '/fake-rpc']);
    await p.waitForSelector('#fpgo'); await p.fill('#fpname', '小林'); await p.waitForTimeout(1500); if (PFX) await p.screenshot({ path: PFX + 'pay-page.png', fullPage: true });
    await p.click('#fpgo'); await p.waitForSelector('.fp-ok, .fp-fail', { timeout: 40000 }); const res = await p.evaluate(() => ({ t: document.querySelector('#fpres').innerText, ix: window.__fpTx, payer: window.__fpPayer }));
    ok(/点亮成功/.test(res.t), '朋友钱包签名付款 → 成功提示 ' + res.t.slice(0, 40)); ok(res.payer === F.pubkey && res.ix.some(x => x.includes('WTFP1|' + L.id + '|' + A.pubkey + '|小林')) && res.ix.some(x => x.includes(text.slice(0, 6))), '交易由朋友钱包付费签名，含心愿 memo + 代付署名');
    if (PFX) { await p.evaluate(() => document.querySelector('#fpres').scrollIntoView()); await p.waitForTimeout(800); await p.screenshot({ path: PFX + 'success.png' }); }
    ok((await call(`/api/fpay/${L.id}/confirm`, { sig: S4 })).j.code === 'fpUsed', '一次性：再次使用 → 已使用');
    const done = (await call('/api/fpay/done')).j; ok(done[S3]?.author === A.pubkey && done[S3].by === '小林' && done[S3].payer === F.pubkey, '代付记录：作者仍为心愿作者，付款人署名');
    const ib = (await call('/api/inbox', null, tk(A))).j.items.find(m => m.kind === 'fpay'); ok(ib && ib.by === '小林' && ib.text === text, '作者收到站内信');
    await p.goto(Bs + '/?lang=zh-CN#/fpay/' + L.id); await p.reload(); await p.waitForSelector('.fp-bad'); ok(/已经由朋友点亮上链/.test(await p.textContent('#fpbox')), '已用链接：清晰提示'); if (PFX) await p.screenshot({ path: PFX + 'used.png' });
    const L2 = (await call('/api/fpay', { memo, lamports: lam }, tk(A))).j, dbf = fs.readdirSync(tmp + '/data').map(f => tmp + '/data/' + f).find(f => { try { return !!JSON.parse(fs.readFileSync(f)).fpay?.[L2.id]; } catch { return false; } });
    const db = JSON.parse(fs.readFileSync(dbf)); db.fpay[L2.id].exp = Date.now() - 1000; fs.writeFileSync(dbf, JSON.stringify(db));
    ok((await call('/api/fpay/' + L2.id)).j.state === 'expired', '超过 24 小时：状态为过期'); await p.goto(Bs + '/?lang=zh-CN#/fpay/' + L2.id); await p.reload(); await p.waitForSelector('.fp-bad'); ok(/24 小时有效期/.test(await p.textContent('#fpbox')), '过期链接：清晰提示'); if (PFX) await p.screenshot({ path: PFX + 'expired.png' });
    await p.goto(Bs + '/?lang=zh-CN#/fpay/0000000000000000'); await p.reload(); await p.waitForSelector('.fp-bad'); ok(/不存在/.test(await p.textContent('#fpbox')), '无效链接：清晰提示');
    // 作者站内信
    const a = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'zh-CN' }), q = await a.newPage(); await q.goto(Bs + '/?lang=zh-CN'); await q.evaluate(t => { localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; localStorage.wt_token = t; }, A.token); await q.goto(Bs + '/?lang=zh-CN#/inbox'); await q.reload();
    await q.waitForFunction(() => /朋友帮你点亮了心愿/.test(document.querySelector('#view').innerText), null, { timeout: 30000 }); ok(/小林 为你的心愿付款上链/.test(await q.textContent('#view')), '作者站内信页面显示代付通知'); await q.waitForTimeout(1500); if (PFX) await q.screenshot({ path: PFX + 'author-inbox.png' });
    await q.goto(Bs + '/?lang=zh-CN#/wish/make'); await q.waitForSelector('.pay-choice', { timeout: 30000 }); ok(!!await q.$('input[name=paymode][value=friend]'), '制作页：作者可选择「请朋友付款」');
    // 前端：作者覆盖（代付交易显示为心愿作者 + 署名）
    const fx = await p.evaluate(([s3, a, f]) => { S.fpDone = { [s3]: { author: a, payer: f, by: '小林' } }; const r = fpFix({ sig: s3, author: f, fp: `WTFP1|x|${a}|小林`, memo: '' }), bad = fpFix({ sig: s3, author: 'someoneElse', memo: '' }); return [r.author === a && r.fpaid && r.by === '小林', bad.author === 'someoneElse', fpBy(r).includes('由 小林 点亮上链')]; }, [S3, A.pubkey, F.pubkey]);
    ok(fx.every(Boolean), '卡片作者仍为写心愿的人，显示「由 小林 点亮上链」；付款人不符时不覆盖');
    ok(!errs.length, '无页面错误 ' + errs.join(' | ')); console.log(`✅ ${n} checks passed`);
  } finally { await browser?.close(); srv.kill(); } })().catch(e => { console.error('FAIL', e.message); process.exit(1); });

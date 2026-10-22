// t259：付款选择、朋友代付可见性、买后送挂树、订单台。ADS_MOCK_PAY=1 模拟链上付款。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), nacl = require('tweetnacl'), b58 = require('bs58').default || require('bs58'), crypto = require('crypto');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS, PFX = SHOTS ? SHOTS + '/t259-' : '';
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-259-')), port = 18998, Bs = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f));
  fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', PRICE_MOCK: '1' }, stdio: 'ignore' });
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await x.json(); } catch {} return { s: x.status, j }; };
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const wlogin = async () => { const kp = nacl.sign.keyPair(), a = b58.encode(kp.publicKey), nonce = (await call('/api/nonce')).j.nonce;
      const m = `${host} wants you to sign in with your Solana account:\n${a}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const r = (await call('/api/login/wallet', { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) })).j; assert(r.token); return { token: r.token, pubkey: a }; };
    const A = await wlogin(), F = await wlogin(), tk = u => ({ authorization: 'Bearer ' + u.token }), cfg = (await call('/api/config')).j, text = '希望奶奶的腿快点好起来，春天能一起去公园散步。', lam = cfg.minLamports;
    const att = (await call('/api/moderate', { text, prefix: '经典' })).j.attestation, memo = `WTREE1|W|${att.hash}|${att.ts}|${att.sig}|经典|${text}`;
    // A: visibility off
    const Lhid = (await call('/api/fpay', { memo, lamports: lam, showText: false }, tk(A))).j;
    ok(Lhid.id && Lhid.showText === false, '代付：可关闭正文可见');
    const ghid = (await call('/api/fpay/' + Lhid.id)).j;
    ok(ghid.hidden && !ghid.text && ghid.cat === '经典' && ghid.lamports === lam, '朋友端：正文隐藏，仍有类型/金额');
    const Lshow = (await call('/api/fpay', { memo, lamports: lam, showText: true }, tk(A))).j;
    ok((await call('/api/fpay/' + Lshow.id)).j.text === text, '朋友端：默认可见正文');
    // B: voucher create → mock pay → claim hang
    const V = (await call('/api/voucher', { lamports: lam, by: '阿明' }, tk(A))).j;
    ok(V.id && V.memo === 'WTVC1|' + V.id && V.exp > Date.now(), '买后送：创建卡券 + memo');
    const mock = {}, sig = () => b58.encode(crypto.randomBytes(64)), wm = () => fs.writeFileSync(tmp + '/data/tx-mock.json', JSON.stringify(mock));
    const S1 = sig(); mock[S1] = { payer: A.pubkey, blockTime: Math.floor(Date.now() / 1000), memos: [V.memo], paid: lam }; wm();
    ok((await call("/api/voucher/" + V.id + "/confirm", { sig: S1 }, tk(A))).j.ok, "买后送：送礼人付款核验通过");
    ok((await call('/api/voucher/' + V.id)).j.state === 'open', '买后送：待领取');
    const claim = await call('/api/voucher/' + V.id + '/claim', { text: '谢谢阿明，愿我们都健康快乐。', cat: '经典', dev: 'd-recv' });
    ok(claim.s === 200 && /^VG_/.test(claim.j.id) && claim.j.gifted, '收卡人无钱包创作 → 挂树');
    const off = (await call('/api/offchain')).j;
    ok(off.gifted?.some(x => x.id === claim.j.id && x.by === '阿明'), 'offchain 含赠送卡');
    ok((await call('/api/voucher/' + V.id + '/claim', { text: '再领一次', cat: '经典' })).s === 409, '卡券单次领取');
    // expire + reclaim
    const V2 = (await call('/api/voucher', { lamports: lam, by: '阿明' }, tk(A))).j;
    const S2 = sig(); mock[S2] = { payer: A.pubkey, blockTime: Math.floor(Date.now() / 1000), memos: [V2.memo], paid: lam }; wm();
    await call('/api/voucher/' + V2.id + '/confirm', { sig: S2 }, tk(A));
    await call('/api/voucher/' + V2.id + '/cancel', {}, tk(A));
    const rec = await call('/api/voucher/' + V2.id + '/claim', { text: '过期后我自己填写的心愿。', cat: '经典', reclaim: true }, tk(A));
    ok(rec.j.ok && rec.j.gifted === false, '过期/取消后送礼人可领回自填');
    const mine = (await call('/api/voucher/mine', null, tk(A))).j;
    ok(mine.given.some(x => x.id === V.id && x.state === 'claimed') && mine.given.some(x => x.id === V2.id), '订单：送礼人可见卡券');
    const fmine = (await call('/api/fpay/mine', null, tk(A))).j;
    ok(fmine.items.some(x => x.id === Lshow.id), '订单：作者可见代付链接');

    const { chromium, devices } = require('playwright'); const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'zh-CN' }); const p = await ctx.newPage();
    await p.goto(Bs + '/?lang=zh-CN'); await p.evaluate(t => { localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; localStorage.wt_token = t; }, A.token);
    // pay choice
    await p.goto(Bs + '/?lang=zh-CN#/wish/make'); await p.reload(); await p.waitForSelector('.pay-choice', { timeout: 60000 });
    ok(await p.$('input[name=paymode][value=self]') && await p.$('input[name=paymode][value=friend]') && await p.$('input[name=paymode][value=gift]'), '制作页：自己付款 / 请朋友付款 / 买卡送给朋友');
    await p.click('input[name=paymode][value=friend]'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => !document.querySelector("#fpOpts")?.classList.contains("hidden") && !!document.querySelector("#fpshow")?.checked), "请朋友付款：正文可见开关默认开");
    if (PFX) await p.screenshot({ path: PFX + 'pay-choice.png', fullPage: true });
    // initiate manage page
    await p.goto(Bs + '/?lang=zh-CN'); await p.evaluate(([pk, tok]) => { localStorage.wt_token = tok; S.token = tok; S.pubkey = pk; S.mode = 'self'; S.kind = 'sol'; }, [A.pubkey, A.token]);
    await p.goto(Bs + '/?lang=zh-CN#/fpay/' + Lshow.id + '/manage'); await p.waitForSelector('#fpshare', { timeout: 60000 });
    ok(/发给朋友/.test(await p.textContent('#fpbox')) && /Solana/.test(await p.textContent('#fpbox')), '发起代付页：发给朋友 + 三条说明');
    if (PFX) await p.screenshot({ path: PFX + 'fpay-manage.png', fullPage: true });
    // friend page show / hide
    const ctx2 = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, locale: 'zh-CN' }); const q = await ctx2.newPage();
    await q.goto(Bs + '/?lang=zh-CN#/fpay/' + Lshow.id); await q.reload(); await q.waitForSelector('.fp-card');
    ok(/希望奶奶/.test(await q.textContent('#fpbox')) && /用钱包付款|连接/.test(await q.textContent('#fpbox')), '朋友代付页（可见正文）');
    if (PFX) await q.screenshot({ path: PFX + 'fpay-friend-show.png', fullPage: true });
    await q.goto(Bs + '/?lang=zh-CN#/fpay/' + Lhid.id); await q.reload(); await q.waitForSelector('.fp-card');
    ok(/先不展示正文/.test(await q.textContent('#fpbox')) && !/希望奶奶/.test(await q.textContent('#fpbox')), '朋友代付页（隐藏正文）');
    if (PFX) await q.screenshot({ path: PFX + 'fpay-friend-hide.png', fullPage: true });
    // voucher manage + write
    await p.evaluate(([pk, tok]) => { S.token = tok; S.pubkey = pk; S.mode = 'self'; }, [A.pubkey, A.token]);
    await p.goto(Bs + '/?lang=zh-CN#/voucher/' + V.id + '/manage'); await p.waitForSelector('#vcbox .card', { timeout: 30000 });
    const vt = await p.textContent('#vcbox');
    ok(/已领取|朋友已/.test(vt), '送礼人页：已领取状态');
    if (PFX) await p.screenshot({ path: PFX + 'voucher-giver.png', fullPage: true });
    const V3 = (await call('/api/voucher', { lamports: lam, by: '阿明' }, tk(A))).j; const S3 = sig(); mock[S3] = { payer: A.pubkey, blockTime: Math.floor(Date.now() / 1000), memos: [V3.memo], paid: lam }; wm();
    await call('/api/voucher/' + V3.id + '/confirm', { sig: S3 }, tk(A));
    await p.goto(Bs + '/?lang=zh-CN#/voucher/' + V3.id + '/manage'); await p.waitForSelector('#vcshare', { timeout: 30000 });
    ok(/等待朋友领取/.test(await p.textContent('#vcbox')), '送礼人待领取页');
    if (PFX) await p.screenshot({ path: PFX + 'voucher-pending.png', fullPage: true });
    await q.goto(Bs + '/?lang=zh-CN#/voucher/' + V3.id + '/write'); await q.reload(); await q.waitForSelector('#vctext');
    ok(/送你一张心愿卡|阿明/.test(await q.textContent('#vcbox')), '收卡人创作页：无需钱包');
    if (PFX) await q.screenshot({ path: PFX + 'voucher-write.png', fullPage: true });
    await q.fill('#vctext', '愿世界温柔以待。'); await q.click('#vcgo'); await q.waitForSelector('.fp-ok', { timeout: 20000 });
    ok(/挂上世界树/.test(await q.textContent('#vcbox')), '确认后立刻挂树');
    if (PFX) await q.screenshot({ path: PFX + 'voucher-hung.png' });
    const cid = (await call('/api/voucher/' + V3.id)).j.card.id;
    await q.goto(Bs + '/?lang=zh-CN'); await q.waitForFunction(() => (S.offc?.gifted || []).length > 0, null, { timeout: 30000 });
    await q.goto(Bs + '/?lang=zh-CN#/w/' + cid); await q.waitForTimeout(1200);
    let detail = await q.textContent('#view');
    if (!/赠送|阿明/.test(detail)) { // open quick view
      await q.evaluate(id => { const w = treeWishes().find(x => x.sig === id); if (w) openCardPopup(lockPaint(w)); }, cid); await q.waitForTimeout(800);
      detail = (await q.textContent('#modal-box')) + detail;
    }
    ok(/赠送|阿明/.test(detail), '挂树卡片显示由某某赠送');
    if (PFX) await q.screenshot({ path: PFX + 'gifted-card.png', fullPage: true });
    // orders
    await p.evaluate(([pk, tok]) => { S.token = tok; S.pubkey = pk; S.mode = 'self'; }, [A.pubkey, A.token]); await p.goto(Bs + '/?lang=zh-CN#/orders'); await p.waitForSelector('#ordbox'); await p.waitForTimeout(800);
    ok(/待付款|待领取|已完成/.test(await p.textContent('#view')), '订单台三个分页');
    if (PFX) await p.screenshot({ path: PFX + 'orders-pay.png', fullPage: true });
    await p.click('[data-otab=claim]'); await p.waitForTimeout(500); if (PFX) await p.screenshot({ path: PFX + 'orders-claim.png', fullPage: true });
    await p.click('[data-otab=done]'); await p.waitForTimeout(500); if (PFX) await p.screenshot({ path: PFX + 'orders-done.png', fullPage: true });
    await browser.close();
    console.log(`✅ ${n} checks passed`);
  } finally { srv.kill(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

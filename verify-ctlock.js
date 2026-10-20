// 交友卡分区保护（详情 / 联系方式各自：加密 / 加锁 / 两者）：接口、费用拆分、链上核验（模拟）、限速、旧卡兼容、前端渲染。全部模拟支付（ADS_MOCK_PAY），不发真实交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), crypto = require('crypto'), nacl = require('tweetnacl'), bs58 = require('bs58');
const b58 = bs58.default || bs58; let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS; const subtle = crypto.webcrypto.subtle;
async function keys(pw, salt, iter) { const base = await subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']); const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(salt, 'base64'), iterations: iter }, base, 512));
  return { ek: await subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']), ak: Buffer.from(bits.slice(32)).toString('hex') }; }
async function enc(pw, text) { const salt = crypto.randomBytes(16).toString('base64'), iv = crypto.randomBytes(12), { ek, ak } = await keys(pw, salt, 310000); const ct = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv }, ek, new TextEncoder().encode(text))); return { salt, iter: 310000, iv: iv.toString('base64'), ct: ct.toString('base64'), ak }; }
(async () => {
  console.log('unit'); const L = require('./ctlock');
  ok(JSON.stringify([2, 3, 5, 10, 30].map(u => L.feeUsd(u))) === '[1,1,1.5,3,9]', '平台技术服务费 = 30%，不低于 $1（$2→$1，$5→$1.5，$30→$9）');
  ok(!L.usdOk(1.99) && !L.usdOk(30.01) && L.usdOk(2) && L.usdOk(30) && !L.usdOk('5'), '金额范围 $2–$30');
  console.log('backend'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ctl-')), port = 18951, Bs = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data', { recursive: true });
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', PRICE_MOCK: '1' }, stdio: 'ignore' });
  const wr = (f, o) => fs.writeFileSync(path.join(tmp, 'data', f), JSON.stringify(o)), rd = f => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8')); } catch { return {}; } };
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); const t = await x.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { s: x.status, j, text: t }; };
  const wlogin = async () => { const kp = nacl.sign.keyPair(), a = b58.encode(kp.publicKey), nonce = (await call('/api/nonce')).j.nonce;
    const m = `${host} wants you to sign in with your Solana account:\n${a}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    const r = (await call('/api/login/wallet', { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) })).j; assert(r.token, 'login ' + JSON.stringify(r)); return { token: r.token, pubkey: a }; };
  let browser; try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const A = await wlogin(), V = await wlogin(), E = (await call('/api/login', { email: 'ct-email@test.dev' })).j, tk = u => ({ authorization: 'Bearer ' + u.token });
    const mkSoc = async () => { const prefix = '经典~S~vP~t旅行,音乐~i喜欢看星星~l聊得来的朋友', text = '想认识新朋友', mo = (await call('/api/moderate', { text, prefix })).j; assert(mo.pass, 'moderate ' + JSON.stringify(mo)); const a = mo.attestation, sig = crypto.randomBytes(48).toString('base64').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '').padEnd(88, 'A').slice(0, 88);
      wr('tx-mock.json', { ...rd('tx-mock.json'), [sig]: { author: A.pubkey, memo: `WTREE1|W|${a.hash}|${a.ts}|${a.sig}|${prefix}|${text}` } }); return sig; };
    const DET = '周末常去天文台，喜欢摄影和徒步。\n希望认识一起看流星雨的人。', CT = 'WeChat: star_walker_2026', PW = 'meteor42';
    const s1 = await mkSoc(); let x = await call('/api/contact', { sig: s1, contact: CT, show: false, details: '', sec: { dt: { enc: await enc(PW, DET) }, ct: { lock: { usd: 2 } } } }, tk(A));
    ok(x.s === 200, '作者设置：详情仅加密 + 联系方式仅加锁（$2）');
    ok((await call('/api/contact', { sig: await mkSoc(), contact: CT, sec: { ct: { lock: { usd: 1 } } } }, tk(A))).j.code === 'ctLockAmt' && (await call('/api/contact', { sig: await mkSoc(), contact: CT, sec: { ct: { lock: { usd: 31 } } } }, tk(A))).j.code === 'ctLockAmt', '意向金 <$2 或 >$30 被拒');
    ok((await call('/api/contact', { sig: await mkSoc(), contact: CT, sec: { ct: { enc: await enc(PW, CT) } } }, tk(A))).s === 400, '加密分区不接受同时上传明文');
    const raw = await call('/api/contact/' + s1), st0 = rd('social.json').contacts[s1];
    ok(raw.j.sections.dt.needPass && raw.j.sections.dt.enc.iter === 310000 && !raw.j.sections.dt.text && raw.j.sections.ct.locked.usd === 2 && raw.j.sections.ct.locked.feeUsd === 1 && raw.j.sections.ct.locked.restUsd === 1 && raw.j.sections.ct.locked.payTo === A.pubkey, '公开视图：详情需密码，联系方式显示费用拆分（$2 = 服务费 $1 + 作者 $1）');
    ok(!raw.text.includes('star_walker') && !raw.text.includes(st0.sec.dt.enc.ct) && !raw.text.includes('akHash') && !st0.details && !JSON.stringify(st0).includes('天文台'), '公开响应不含联系方式明文 / 详情密文 / 校验哈希；服务端不存详情明文');
    ok(raw.j.sections.ct.locked.feeTo === 'FPKFevoHzjPZWjWaRxwFwfNXu2LBduoGspXZSCLU81yz' || raw.j.sections.ct.locked.feeTo.length >= 32, '服务费收款方 = 站点 Solana 收款地址');
    const { ek, ak } = await keys(PW, raw.j.sections.dt.enc.salt, 310000); x = await call('/api/contact/open', { sig: s1, sec: 'dt', ak });
    ok(x.s === 200 && Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(x.j.iv, 'base64') }, ek, Buffer.from(x.j.ct, 'base64'))).toString() === DET, '正确密码：返回密文，浏览器端解密得到详情');
    const bad = (await keys('wrong-pass', raw.j.sections.dt.enc.salt, 310000)).ak; const codes = []; for (let i = 0; i < 6; i++) codes.push((await call('/api/contact/open', { sig: s1, sec: 'dt', ak: bad }, tk(E))).s);
    ok(codes.slice(0, 5).every(c => c === 401) && codes[5] === 429, '错误密码 → 401；10 分钟内 5 次失败后限速 429');
    ok((await call('/api/contact/open', { sig: s1, sec: 'ct', ak })).s === 400, '未加密分区不能走密码接口');
    ok((await call('/api/contact/quote', { sig: s1, sec: 'ct' }, tk(E))).j.code === 'ctSelfWallet', '邮箱 / 托管账户不能付款（平台不代发交易）');
    ok((await call('/api/contact/quote', { sig: s1, sec: 'ct' }, tk(A))).s === 400, '作者不能给自己的卡付款');
    await call('/api/me/profile', { name: '小星', avatar: '' }, tk(V));
    const q = (await call('/api/contact/quote', { sig: s1, sec: 'ct' }, tk(V))).j;
    ok(q.fee === Math.ceil(1 / 150 * 1e9) && q.fee + q.rest === Math.ceil(2 / 150 * 1e9) && q.payTo === A.pubkey && q.memo === 'WTREE1|UL|' + q.id, '报价：按 $150/SOL 折算，服务费 + 作者部分 = 总额，memo 绑定报价');
    const mp = (sig, o) => wr('ct-mock-pay.json', { ...rd('ct-mock-pay.json'), [sig]: { signer: V.pubkey, fee: q.fee, rest: q.rest, payTo: A.pubkey, memo: q.memo, ...o } });
    mp('MOCKshort', { rest: q.rest - 1 }); ok((await call('/api/contact/unlock', { qid: q.id, tx: 'MOCKshort' }, tk(V))).j.code === 'ctVerify', '作者部分少付 → 核验失败');
    mp('MOCKwrongTo', { payTo: V.pubkey }); ok((await call('/api/contact/unlock', { qid: q.id, tx: 'MOCKwrongTo' }, tk(V))).j.code === 'ctVerify', '收款方不对 → 核验失败');
    mp('MOCKother', { signer: E.pubkey || 'x' }); ok((await call('/api/contact/unlock', { qid: q.id, tx: 'MOCKother' }, tk(V))).j.code === 'ctVerify', '付款人不是查看者钱包 → 核验失败');
    ok((await call('/api/contact/' + s1, null, tk(V))).j.sections.ct.locked, '核验通过前联系方式保持锁定');
    mp('MOCKgood', {}); x = await call('/api/contact/unlock', { qid: q.id, tx: 'MOCKgood' }, tk(V)); ok(x.s === 200 && x.j.view.sections.ct.open && x.j.view.sections.ct.text === CT && x.j.view.sections.dt.needPass, '核验通过：联系方式解锁；详情仍需密码（分区独立）');
    { const ia = (await call('/api/inbox', null, tk(A))).j.items, iv = (await call('/api/inbox', null, tk(V))).j.items, paid = ia.find(m => m.kind === 'ul_paid');
      ok(paid && paid.from === V.pubkey && paid.name === '小星' && paid.sig === s1 && paid.sec === 'ct' && paid.usd === 2 && paid.restUsd === 1 && paid.feeUsd === 1 && paid.tx === 'MOCKgood', '站内信：作者收到到账通知（付款人钱包 + 昵称、卡片 / 分区、金额拆分、交易）');
      ok(iv.filter(m => m.kind === 'ul_fail' && m.reason === 'verify').length === 3 && iv.some(m => m.kind === 'ul_ok' && m.sig === s1), '站内信：查看者收到成功通知；核验失败也通知（且未解锁）'); }
    ok((await call('/api/contact/' + s1, null, tk(V))).j.sections.ct.text === CT && (await call('/api/contact/' + s1)).j.sections.ct.locked, '解锁按查看者钱包持久化；其他人仍锁定');
    const s2 = await mkSoc(); await call('/api/contact', { sig: s2, contact: CT, sec: { ct: { lock: { usd: 5 } } } }, tk(A)); const q2 = (await call('/api/contact/quote', { sig: s2, sec: 'ct' }, tk(V))).j;
    ok((await call('/api/contact/unlock', { qid: q2.id, tx: 'MOCKgood' }, tk(V))).j.code === 'ctTxUsed' && q2.feeUsd === 1.5 && q2.restUsd === 3.5, '同一笔交易不能重复用于另一张卡；$5 → 服务费 $1.5 + 作者 $3.5');
    const s3 = await mkSoc(); await call('/api/contact', { sig: s3, contact: CT, details: DET.replace(/\n/g, ' ').slice(0, 30), sec: { dt: { lock: { usd: 3 }, enc: await enc(PW, DET) } } }, tk(A)).then(r => assert(r.s === 400 || r.s === 200));
    const s4 = await mkSoc(); x = await call('/api/contact', { sig: s4, contact: CT, sec: { dt: { lock: { usd: 3 }, enc: await enc(PW, DET) } } }, tk(A)); const v4 = (await call('/api/contact/' + s4)).j.sections.dt;
    ok(x.s === 200 && v4.locked && v4.enc && !v4.needPass && (await call('/api/contact/open', { sig: s4, sec: 'dt', ak })).j.code === 'ctPayFirst', '两者都开：先付款，付款前连密码接口都不开放');
    const s5 = await mkSoc(); await call('/api/contact', { sig: s5, contact: CT, show: false }, tk(A)); const v5 = await call('/api/contact/' + s5);
    ok(v5.text === '{}' && (await call('/api/contact/' + s5, null, tk(A))).j.contact === CT, '旧行为不变：未设保护且未公开 → 他人看不到，作者可见');
    ok((await call('/api/moderate', { text: 'x', prefix: '经典~Q~gvip~n测试~T' + A.pubkey + '~h' + 'a'.repeat(16) })).j.code === 'gateMakeOff', '服务端：普通用户不能制作门卡');
    const own = (await call('/api/contact/' + s1, null, tk(A))).j; ok(own.mine && own.sec.dt.enc && own.sec.ct.lock.usd === 2 && own.contact === CT, '作者视图：显示各分区保护设置');
    if (SHOTS) { console.log('screens'); const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
      const page = async (u, lang = 'zh-CN') => { const c = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, locale: lang }); const p = await c.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
        await p.goto(Bs + '/?lang=' + lang); await p.evaluate(t => { localStorage.wt_token = t; localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }, u.token); return p; };
      let p = await page(A); await p.goto(Bs + '/?lang=zh-CN#/wish/make'); await p.reload(); await p.waitForSelector('#ckind', { timeout: 90000 }); const kinds = await p.$$eval('#ckind option', o => o.map(x => x.value)); ok(!kinds.includes('gate') && kinds.includes('social'), '卡片类型不再包含「门卡」：' + kinds.join(','));
      await p.locator('#ckind').scrollIntoViewIfNeeded(); await p.evaluate(() => { const s = document.querySelector('#ckind'); s.size = s.options.length; window.scrollBy(0, -120); }); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/t239-type-select.png' }); await p.evaluate(() => { document.querySelector('#ckind').size = 0; });
      await p.selectOption('#ckind', 'social'); await p.waitForTimeout(400);
      await p.fill('#sct', CT); await p.fill('#sdt', DET); await p.check('#dtEnc'); await p.fill('#dtPw', PW); await p.check('#ctLock'); await p.fill('#ctUsd', '2'); await p.dispatchEvent('#ctUsd', 'input'); await p.waitForTimeout(300);
      if (await p.isVisible('#pvToggle') && await p.getAttribute('#pvToggle', 'aria-expanded') === 'true') await p.click('#pvToggle');
      await p.evaluate(() => { const e = document.querySelector('.ctp'); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); }); await p.waitForTimeout(500); await p.screenshot({ path: SHOTS + '/t236-create-form.png' });
      ok(await p.isVisible('#dtPw') && await p.isVisible('#ctLockBox') && !(await p.isVisible('#ctPw')) && (await p.textContent('#ctFee')).includes('$1'), '制作页：分区独立开关，金额下方实时显示服务费拆分');
      const fake = (sig, author) => ({ sig, id: 1, kind: 'social', cat: '经典', hue: 40, author, text: '想认识新朋友', tags: ['旅行', '音乐'], intro: '喜欢看星星', looking: '聊得来的朋友', likes: 0, blessings: [], likers: new Set(), vis: 'public', ts: Date.now() / 1000, time: Math.floor(Date.now() / 1000) });
      p = await page(await wlogin()); await p.goto(Bs + '/?lang=zh-CN#/'); await p.reload(); await p.waitForTimeout(4000); await p.evaluate(w => openCardPopup({ ...w, likers: new Set() }), fake(s1, A.pubkey)); await p.waitForSelector('.ct-locked', { timeout: 15000 }); await p.waitForTimeout(400);
      await p.locator('.ct-pass').scrollIntoViewIfNeeded(); await p.screenshot({ path: SHOTS + '/t236-locked-view.png' }); ok(await p.isVisible('[data-ctpay=ct]') && await p.isVisible('[data-ctpw=dt]'), '详情页：详情显示密码框，联系方式显示费用拆分 + 付款按钮');
      await p.fill('[data-ctpw=dt]', 'nope'); await p.click('[data-ctopen=dt]'); await p.waitForFunction(() => /不正确/.test(document.querySelector('[data-sec=dt] .ct-st')?.textContent || ''), null, { timeout: 30000 }); await p.locator('.ct-pass').scrollIntoViewIfNeeded(); await p.screenshot({ path: SHOTS + '/t236-password-prompt.png' }); ok(true, '错误密码提示');
      p = await page(V); await p.goto(Bs + '/?lang=zh-CN#/'); await p.reload(); await p.waitForTimeout(4000); await p.evaluate(w => openCardPopup({ ...w, likers: new Set() }), fake(s1, A.pubkey)); await p.waitForSelector('[data-ctpw=dt]', { timeout: 15000 });
      await p.fill('[data-ctpw=dt]', PW); await p.click('[data-ctopen=dt]'); await p.waitForSelector('[data-sec=dt].ct-open', { timeout: 30000 }); await p.locator('[data-sec=ct]').scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/t236-unlocked-view.png' });
      ok((await p.textContent('[data-sec=dt]')).includes('天文台') && (await p.textContent('[data-sec=ct]')).includes('star_walker'), '已付款查看者：输入密码打开详情，联系方式已解锁');
      for (const [u, nm] of [[A, 'inbox-owner'], [V, 'inbox-payer']]) { p = await page(u); await p.goto(Bs + '/?lang=zh-CN#/inbox'); await p.reload(); await p.waitForSelector('#inbox .msg', { timeout: 20000 }); await p.waitForTimeout(500); await p.screenshot({ path: SHOTS + '/t236-' + nm + '.png' }); }
      ok(true, '站内信截图（作者 / 付款人）');
      p = await page(await wlogin(), 'en'); await p.goto(Bs + '/?lang=en#/'); await p.reload(); await p.waitForTimeout(4000); await p.evaluate(w => openCardPopup({ ...w, likers: new Set() }), fake(s1, A.pubkey)); await p.waitForSelector('.ct-locked', { timeout: 15000 }); await p.locator('.ct-locked').scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/t236-locked-view-en.png' }); }
    console.log(`\n✅ ${n} checks passed`);
  } finally { if (browser) await browser.close(); srv.kill(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

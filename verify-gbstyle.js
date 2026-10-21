// t243：团购卡面自定义样式（双面相同 / 封面·内容分开 / 折页 + 背面）：服务端 normFace 校验、旧批次兼容、编辑器选项 / 背面上传 / 实时预览。模拟数据，不发真实交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), nacl = require('tweetnacl'), bs58 = require('bs58');
const b58 = bs58.default || bs58; let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS, IMGS = { cover: '/tmp/cs-cover.png', back: '/tmp/cs-back.png' };
(async () => {
  const B = require('./batch'), H = '/api/img/' + 'a'.repeat(32), H2 = '/api/img/' + 'b'.repeat(32), ok1 = f => B.normFace(f, () => true);
  ok(JSON.stringify(ok1({ cover: 1, inside: 2, text: 'x' }).ok) === JSON.stringify({ cover: 1, inside: 2, cimg: '', nimg: '', text: 'x' }), '旧批次卡面（无 style）原样保留');
  ok(ok1({ cimg: H, style: 'overlay' }).ok.style === 'overlay' && ok1({ cimg: H, style: 'split' }).ok.style === 'split', '自定义封面：双面相同 / 分开');
  { const r = ok1({ cimg: H, style: 'fold', bimg: H2 }).ok; ok(r.style === 'fold' && r.bimg === H2 && B.faceHashes(r).includes('b'.repeat(32)), '折页：背面图保存并纳入图片审核检查'); }
  ok(!ok1({ cimg: H, style: 'split', bimg: H2 }).ok.bimg && !ok1({ cover: 1, style: 'fold' }).ok.style, '仅折页保留背面；无自定义封面不带样式');
  ok(ok1({ cimg: H, style: 'weird' }).error === 'face' && ok1({ cimg: H, style: 'fold', bimg: 'https://evil.example/x.png' }).error, '非法样式 / 外链背面被拒');
  if (!SHOTS) { console.log(`\n✅ ${n} checks passed`); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-gbs-')), port = 18981, Bs = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data', { recursive: true });
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', PRICE_MOCK: '1' }, stdio: 'ignore' });
  const call = async (p, body) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return x.json().catch(() => ({})); };
  let browser; try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const kp = nacl.sign.keyPair(), a = b58.encode(kp.publicKey), nonce = (await call('/api/nonce')).nonce;
    const m = `${host} wants you to sign in with your Solana account:\n${a}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    const tok = (await call('/api/login/wallet', { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) })).token; assert(tok);
    const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const errs = [];
    const c = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, locale: 'zh-CN' }); const p = await c.newPage(); p.on('pageerror', e => { errs.push(e.message); console.log('ERR', e.message); });
    let upN = 0; // 本地无图片审核服务：模拟「上传 + 审核通过」并回放图片（线上走真实 /api/img 审核）
    await p.route(/\/api\/img$/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ hash: (upN++ ? 'd' : 'c').repeat(32) }) }));
    await p.route(/\/api\/img\/[cd]{32}/, r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(/c{32}/.test(r.request().url()) ? IMGS.cover : IMGS.back) }));
    await p.goto(Bs + '/?lang=zh-CN'); await p.evaluate(t => { localStorage.wt_token = t; localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }, tok);
    await p.goto(Bs + '/?lang=zh-CN#/wish/make?gift=batch'); await p.reload(); await p.waitForSelector('#gbxface', { timeout: 90000 }); await p.waitForTimeout(800);
    await p.fill('#gbb', '感谢一路同行，祝新年快乐！').catch(() => {}); await p.fill('#gbg', '星叶会员').catch(() => {}); await p.fill('#gbxtext', '凭此卡可领取年度礼盒一份');
    ok(await p.isHidden('#gbxcsRow'), '未上传自定义封面：不显示样式选择（旧样式）');
    await p.setInputFiles('#gbxupC', IMGS.cover);
    await p.waitForFunction(() => !document.querySelector('#gbxcsRow').hidden, null, { timeout: 30000 }); await p.waitForTimeout(500);
    const o = await p.$$eval('#gbxcst option', o => o.map(x => x.textContent)); ok(o.length === 3 && o[2].includes('封面 + 内页 + 背面'), '团购编辑器：自定义封面 → 3 种样式：' + o.join(' | '));
    await p.locator('#gbxcsRow').scrollIntoViewIfNeeded(); await p.evaluate(() => { const s = document.querySelector('#gbxcst'); s.size = 3; window.scrollBy(0, -200); }); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/t243-style-select.png' }); await p.evaluate(() => { document.querySelector('#gbxcst').size = 0; });
    for (const [v, sel] of [['overlay', '#gbxpv .gb-fov .gb-ovt'], ['split', '#gbxpv [data-gbflip]'], ['fold', '#gbxpv .gb-cs3 .gb-fb img']]) {
      await p.selectOption('#gbxcst', v); await p.waitForTimeout(400);
      if (v === 'fold') { ok(await p.isVisible('#gbxupBRow') && await p.$('#gbxpv .gb-cs3 .pv-defback'), '折页：背面上传可见；未传时默认背面'); await p.setInputFiles('#gbxupB', IMGS.back); await p.waitForSelector(sel, { timeout: 30000 }); }
      if (v === 'split') { await p.click('#gbxpv [data-gbflip]'); await p.waitForTimeout(1000); ok(await p.$('#gbxpv [data-gbflip].flipped'), '分开：点击翻面'); }
      ok(await p.$(sel) && (await p.textContent('#gbxpv')).includes('年度礼盒'), `预览：${v}`);
      await p.locator('#gbxpv').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -80)); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + `/t243-${v}-preview.png` }); }
    const f = await p.evaluate(() => S.gbFE.face()); ok(f.style === 'fold' && /^\/api\/img\/[0-9a-f]{32}$/.test(f.bimg), '提交数据：整批共用 face.style / face.bimg（已过上传审核）');
    ok(!errs.length, '无页面错误');
    console.log(`\n✅ ${n} checks passed`);
  } finally { if (browser) await browser.close(); srv.kill(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

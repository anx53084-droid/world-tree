// t241：自定义封面三种卡片样式（单页双面相同 / 单页封面·内容分开 / 折页 封面+内页+背面）：memo 编解码与旧卡兼容、服务端背面图审核、制作页选项 / 预览、树上与详情。模拟数据，不发真实交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), crypto = require('crypto'), nacl = require('tweetnacl'), bs58 = require('bs58');
const b58 = bs58.default || bs58; let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS, IMGS = { cover: '/tmp/cs-cover.png', back: '/tmp/cs-back.png' };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cs-')), port = 18971, Bs = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data', { recursive: true });
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', PRICE_MOCK: '1' }, stdio: 'ignore' });
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); const t = await x.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { s: x.status, j, text: t }; };
  const wlogin = async () => { const kp = nacl.sign.keyPair(), a = b58.encode(kp.publicKey), nonce = (await call('/api/nonce')).j.nonce;
    const m = `${host} wants you to sign in with your Solana account:\n${a}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    const r = (await call('/api/login/wallet', { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) })).j; assert(r.token, 'login ' + JSON.stringify(r)); return { token: r.token, pubkey: a }; };
  let browser; try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const H = 'a'.repeat(32), H2 = 'b'.repeat(32);
    const mo = await call('/api/moderate', { text: '愿家人平安', prefix: `经典~F00~C${H}~I01~R${H2}` }); ok(mo.s === 400 && !mo.j.pass, '服务端：背面图 ~R 未上传 / 未审核 → 拒绝上链');
    ok((await call('/api/moderate', { text: '愿家人平安', prefix: '经典~vP' })).j.pass, '普通心愿不受影响');
    const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const A = await wlogin(), errs = [];
    const page = async (u, lang = 'zh-CN') => { const c = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, locale: lang }); const p = await c.newPage(); p.on('pageerror', e => { errs.push(e.message); console.log('ERR', e.message); });
      await p.route(/\/api\/img\/([ab]{32})$/, r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(/a{32}$/.test(r.request().url()) ? IMGS.cover : IMGS.back) }));
      await p.goto(Bs + '/?lang=' + lang); await p.evaluate(t => { localStorage.wt_token = t; localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }, u.token); return p; };
    let p = await page(A); await p.goto(Bs + '/?lang=zh-CN#/wish/make'); await p.reload(); await p.waitForSelector('#ckind', { timeout: 90000 });
    const P = await p.evaluate(([H, H2]) => ({ ov: parseOpt(`经典~K00~C${H}~Uo`), sp: parseOpt(`经典~C${H}`), fd: parseOpt(`经典~F00~C${H}~N${H}~R${H2}`), oldF: parseOpt(`经典~F00~C${H}~I01`), plain: parseOpt('经典~vP'),
      st: [parseOpt(`经典~K00~C${H}~Uo`), parseOpt(`经典~C${H}`), parseOpt(`经典~F00~C${H}~I01`), parseOpt('经典~vP')].map(cStyle) }), [H, H2]);
    ok(P.ov.ustyle === 'o' && !P.ov.folded && P.fd.bimg === H2 && P.fd.folded && !P.oldF.bimg, 'memo：~Uo = 双面相同，~R = 背面图');
    ok(P.st.join() === 'overlay,split,fold,', '旧卡兼容：旧自定义单卡 → 封面/内容分开；旧自定义折页 → 折页（默认背面）；非自定义卡不变');
    await p.selectOption('#wc2', '自定义'); await p.waitForTimeout(300);
    const opts = await p.$$eval('#ctype option', o => o.map(x => x.value + ':' + x.textContent)); ok(opts.length === 3 && opts[0].startsWith('overlay') && opts[2].startsWith('folded'), '自定义 → 卡片样式 3 个选项：' + opts.join(' | '));
    await p.setInputFiles('#upC', IMGS.cover); await p.fill('#wt', '愿家人平安喜乐，\n新的一年万事顺遂。'); await p.waitForTimeout(800);
    await p.locator('#ctypeRow').scrollIntoViewIfNeeded(); await p.evaluate(() => { const s = document.querySelector('#ctype'); s.size = 3; window.scrollBy(0, -160); }); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/t241-select.png' }); await p.evaluate(() => { document.querySelector('#ctype').size = 0; });
    if (await p.isVisible('#pvToggle') && await p.getAttribute('#pvToggle', 'aria-expanded') !== 'true') await p.click('#pvToggle');
    for (let [v, nm, sel] of [['overlay', 'overlay', '.pv-ov .pv-ovtext'], ['single', 'split', '.pv-split .pv-plain'], ['folded', 'folded', '.pv-three .pv-defback']]) {
      await p.selectOption('#ctype', v); await p.dispatchEvent('#ctype', 'input'); await p.waitForTimeout(500);
      if (v === 'folded') { ok(await p.isVisible('#upB'.replace('#upB', '#upBRow')), '折页：显示背面上传（可选）'); ok(await p.$('.pv-three .pv-defback'), '折页预览：未传背面 → 默认背面'); await p.setInputFiles('#upB', IMGS.back); await p.waitForTimeout(800); sel = '.pv-three .pv-page:nth-child(2) img'; }
      ok(await p.$(sel) && (await p.textContent('#pvBody')).includes('家人平安') && await p.isHidden('.pv-modes'), `预览：${nm} 样式实时显示`);
      await p.locator('#pvBody').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -60)); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + `/t241-${nm}-preview.png` }); }
    await p.selectOption('#wc2', '经典'); await p.waitForTimeout(300); ok((await p.$$eval('#ctype option', o => o.map(x => x.value))).join() === 'single,folded', '非自定义主题：仍为 单张 / 折页 两项');
    const mk = (sig, id, o) => ({ sig, id, cat: '经典', hue: 40, author: A.pubkey, text: '愿家人平安喜乐，新的一年万事顺遂。', likes: 2, blessings: [], likers: [], vis: 'public', deliver: 'tree', kind: 'wish', cover: 0, cimg: H, ts: Date.now() / 1000, time: Math.floor(Date.now() / 1000), ...o });
    for (const [nm, o, sel] of [['overlay', { ustyle: 'o' }, '.cflip.one .cf-over'], ['split', {}, '.cflip.flipped .cf-back'], ['folded', { folded: true, inside: 1, bimg: H2 }, '.fold.open .fold-back-img']]) {
      p = await page(A); await p.goto(Bs + '/?lang=zh-CN#/'); await p.reload(); await p.waitForTimeout(5000);
      const sig = 'CS' + nm + crypto.randomBytes(8).toString('hex');
      const id = await p.evaluate(w => { w.likers = new Set(); w.id = S.wishes.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; S.wishes.push(w); WT3D.update(treeWishes().map(lockPaint), openCardPopup, { stress: S.stress, total: S.total }); return w.id; }, mk(sig, 0, o));
      const jr = await p.evaluate(i => WT3D.jumpTo(i).then(r => !!r), id); await p.waitForTimeout(4000); await p.screenshot({ path: SHOTS + `/t241-${nm}-tree.png` }); ok(jr, `树上：${nm} 卡挂上树`);
      await p.evaluate(s => openCardPopup(S.wishes.find(w => w.sig === s)), sig); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(1300);
      await p.screenshot({ path: SHOTS + `/t241-${nm}-detail.png` }); ok(true, `详情：${nm}`);
      if (nm === 'split') { await p.click('#cfFlip'); await p.waitForTimeout(1100); await p.screenshot({ path: SHOTS + '/t241-split-detail-front.png' }); ok(await p.$('.cflip:not(.flipped)'), '详情：封面 ↔ 内容 可翻面'); } }
    ok(!errs.length, '无页面错误');
    console.log(`\n✅ ${n} checks passed`);
  } finally { if (browser) await browser.close(); srv.kill(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

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
    for (const [nm, o, sel] of [['overlay', { ustyle: 'o' }, '.qv-page.qv-inner.on .cf-over'], ['split', {}, '.qv-page.qv-inner.on .fold-inbody'], ['folded', { folded: true, inside: 1, bimg: H2 }, '.qv-page.qv-inner.on']]) {
      p = await page(A); await p.goto(Bs + '/?lang=zh-CN#/'); await p.reload(); await p.waitForTimeout(5000);
      const sig = 'CS' + nm + crypto.randomBytes(8).toString('hex');
      const id = await p.evaluate(w => { w.likers = new Set(); w.id = S.wishes.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; window.__cw = w; S.wishes.push(w); WT3D.update(treeWishes().map(lockPaint), openCardPopup, { stress: S.stress, total: S.total }); return w.id; }, mk(sig, 0, o));
      const jr = await p.evaluate(i => WT3D.jumpTo(i).then(r => !!r), id); await p.waitForTimeout(4000); await p.screenshot({ path: SHOTS + `/t241-${nm}-tree.png` }); ok(jr, `树上：${nm} 卡挂上树`);
      await p.evaluate(s => openCardPopup(S.wishes.find(w => w.sig === s) || window.__cw), sig); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(1300);
      await p.screenshot({ path: SHOTS + `/t241-${nm}-detail.png` }); ok(true, `详情：${nm}`);
      if (nm === 'split') { await p.click('[data-qv="0"]'); await p.waitForTimeout(1100); await p.screenshot({ path: SHOTS + '/t241-split-detail-front.png' }); ok(await p.$('.qv-page.qv-cover.on'), '详情：封面 ↔ 内容 可翻页（t248 翻页器）'); }
      if (nm === 'folded') { await p.click('[data-qv="2"]'); await p.waitForTimeout(1100); ok(await p.$('.qv-page.qv-back.on img.qv-art'), '折页：背面页显示上传背面'); } }
    // t242：所有用户卡类型（门卡除外）都提供三种样式
    { const SEC = 'WeChat: secret_star_42', DET = 'SECRETDETAIL 天文台'; p = await page(A); await p.goto(Bs + '/?lang=zh-CN#/wish/make'); await p.reload(); await p.waitForSelector('#ckind', { timeout: 90000 });
      await p.selectOption('#ckind', 'social'); await p.waitForTimeout(300); await p.selectOption('#wc2', '自定义'); await p.waitForTimeout(300);
      const o2 = await p.$$eval('#ctype option', o => o.map(x => x.textContent)); ok(o2.length === 3 && o2[2].includes('封面 + 内页 + 背面'), '交友卡 + 自定义：3 种样式，折页标注「封面 + 内页 + 背面」');
      await p.setInputFiles('#upC', IMGS.cover); await p.fill('#wt', '想认识一起看星星的朋友'); await p.fill('#stg', '旅行,音乐,摄影'); await p.fill('#sin', '喜欢夜跑和天文'); await p.fill('#slk', '聊得来的朋友');
      await p.fill('#sct', SEC); await p.fill('#sdt', DET); await p.check('#dtEnc'); await p.fill('#dtPw', 'meteor42'); await p.check('#ctLock'); await p.fill('#ctUsd', '2'); await p.dispatchEvent('#ctUsd', 'input'); await p.waitForTimeout(800);
      await p.locator('#ctypeRow').scrollIntoViewIfNeeded(); await p.evaluate(() => { const s = document.querySelector('#ctype'); s.size = 3; window.scrollBy(0, -160); }); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/t242-social-select.png' }); await p.evaluate(() => { document.querySelector('#ctype').size = 0; });
      if (await p.isVisible('#pvToggle') && await p.getAttribute('#pvToggle', 'aria-expanded') !== 'true') await p.click('#pvToggle');
      for (const [v, nm] of [['overlay', 'overlay'], ['single', 'split'], ['folded', 'folded']]) { await p.selectOption('#ctype', v); await p.dispatchEvent('#ctype', 'input'); await p.waitForTimeout(500);
        if (v === 'folded') { ok(await p.isVisible('#upBRow'), '交友卡折页：显示背面上传'); await p.setInputFiles('#upB', IMGS.back); await p.waitForTimeout(800); }
        const tx = await p.textContent('#pvBody'); ok(tx.includes('喜欢夜跑') && !tx.includes('secret_star') && !tx.includes('SECRETDETAIL') && tx.includes('不会显示在卡面'), `交友卡 ${nm} 预览：显示公开资料，不含联系方式 / 详情`);
        await p.locator('#pvBody').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -60)); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + `/t242-social-${nm}-preview.png` }); }
      for (const [k, fill, nm] of [['wish', async () => p.fill('#wt', '愿家人平安喜乐'), 'wish'], ['gift', async () => { await p.fill('#gto', A.pubkey); await p.fill('#gnt', '生日快乐，愿你被温柔以待'); }, 'gift'], ['goods', async () => { await p.fill('#wt', '想要一台天文望远镜'); }, 'goods'], ['biz', async () => { await p.fill('#bzname', '星叶科技'); await p.fill('#bzurl', 'https://starleaf.example.com'); await p.fill('#bzintro', '为小团队打造好用的协作工具。'); }, 'biz']]) {
        await p.selectOption('#ckind', k); await p.waitForTimeout(400); if (k !== 'biz') { await p.selectOption('#wc2', '自定义'); await p.waitForTimeout(300); }
        ok((await p.$$eval('#ctype option', o => o.length)) === 3, `${k}：自定义提供 3 种样式`); await fill(); await p.selectOption('#ctype', 'folded'); await p.dispatchEvent('#ctype', 'input'); await p.waitForTimeout(600);
        ok(await p.isVisible('#upBRow') && await p.$('.pv-three'), `${k}：折页预览（封面 / 背面 / 内页）`); await p.locator('#pvBody').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -60)); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + `/t242-${nm}-folded-preview.png` }); }
      p = await page(A); await p.goto(Bs + '/?lang=zh-CN#/'); await p.reload(); await p.waitForTimeout(5000);
      const sw = mk('CSsoc' + crypto.randomBytes(6).toString('hex'), 0, { kind: 'social', text: '想认识一起看星星的朋友', tags: ['旅行', '音乐'], intro: '喜欢夜跑和天文', looking: '聊得来的朋友', ustyle: 'o', contact: SEC, details: DET });
      const r = await p.evaluate(w => { w.likers = new Set(); w.id = S.wishes.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; window.__sw = w; S.wishes.push(w); WT3D.update(treeWishes().map(lockPaint), openCardPopup, { stress: S.stress, total: S.total }); return { st: cStyle(w), sum: WTsumm(w), id: w.id }; }, sw);
      ok(r.st === 'overlay' && r.sum.includes('喜欢夜跑') && !r.sum.includes('secret') && !r.sum.includes('SECRET'), '交友卡卡面摘要：只含公开字段');
      await p.evaluate(i => WT3D.jumpTo(i), r.id); await p.waitForTimeout(4000); await p.screenshot({ path: SHOTS + '/t242-social-overlay-tree.png' });
      await p.evaluate(() => openCardPopup(window.__sw)); await p.waitForSelector('.qv-page.on .cf-over', { timeout: 15000 }); await p.waitForTimeout(800);
      const dt = await p.textContent('#modal, .modal, body'); ok(!dt.includes('secret_star') && !dt.includes('SECRETDETAIL'), '交友卡双面相同详情：不泄露联系方式 / 详情'); await p.screenshot({ path: SHOTS + '/t242-social-overlay-detail.png' }); }
    ok(!errs.length, '无页面错误');
    console.log(`\n✅ ${n} checks passed`);
  } finally { if (browser) await browser.close(); srv.kill(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

// 企业展示卡（t240）：服务端校验（名称 / 官网 / 简介 / 黑名单 / 内网）、上链 memo 解析、链下元数据登记（仅作者、域名一致）、前端制作 / 预览 / 树上 / 内页。模拟交易，不发真实交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), crypto = require('crypto'), nacl = require('tweetnacl'), bs58 = require('bs58');
const b58 = bs58.default || bs58; let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS;
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#0f2747"/><circle cx="300" cy="330" r="150" fill="#f6d38a"/><path d="M220 380 L300 230 L380 380 Z" fill="#0f2747"/><text x="300" y="610" font-size="64" text-anchor="middle" fill="#f6d38a" font-family="sans-serif" font-weight="700">STARLEAF</text></svg>`;
(async () => {
  const Soc = require('./social');
  { const K = Soc.parseKind('经典~E~vP~n星叶科技~Dstarleaf.example.com'); ok(K.kind === 'biz' && K.name === '星叶科技' && K.domain === 'starleaf.example.com', 'memo 解析：~E 企业展示卡（名称 + 域名）'); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-biz-')), port = 18961, Bs = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data', { recursive: true });
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', PRICE_MOCK: '1' }, stdio: 'ignore' });
  const wr = (f, o) => fs.writeFileSync(path.join(tmp, 'data', f), JSON.stringify(o)), rd = f => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8')); } catch { return {}; } };
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); const t = await x.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { s: x.status, j, text: t }; };
  const wlogin = async () => { const kp = nacl.sign.keyPair(), a = b58.encode(kp.publicKey), nonce = (await call('/api/nonce')).j.nonce;
    const m = `${host} wants you to sign in with your Solana account:\n${a}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    const r = (await call('/api/login/wallet', { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) })).j; assert(r.token, 'login ' + JSON.stringify(r)); return { token: r.token, pubkey: a }; };
  let browser; try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const A = await wlogin(), V = await wlogin(), tk = u => ({ authorization: 'Bearer ' + u.token });
    const NAME = '星叶科技', URL_ = 'https://www.starleaf.example.com/about?ref=wt', INTRO = '星叶科技专注于为小型团队打造简洁好用的协作工具。\n我们的产品帮助团队管理任务、文档与日程。';
    const good = { name: NAME, url: URL_, intro: INTRO, theme: 'navy', layout: 'left' };
    let x = await call('/api/biz/check', good); ok(x.s === 200 && x.j.domain === 'starleaf.example.com' && x.j.theme === 'navy' && x.j.layout === 'left', '校验通过：域名去掉 www 并小写');
    for (const [u, why] of [['javascript:alert(1)', 'javascript:'], ['ftp://a.com/', 'ftp'], ['https://user:pw@a.com/', '带账号密码'], ['http://localhost:8080/', 'localhost'], ['http://192.168.1.1/', '内网 IP'], ['http://8.8.8.8/', '裸 IP'], ['https://intranet/', '无点主机名'], ['not a url', '非网址']])
      ok((await call('/api/biz/check', { ...good, url: u })).j.code === 'bizUrl', '官网被拒：' + why);
    ok((await call('/api/biz/check', { ...good, name: '' })).j.code === 'bizName' && (await call('/api/biz/check', { ...good, name: 'x'.repeat(31) })).j.code === 'bizName' && (await call('/api/biz/check', { ...good, name: 'A<b>' })).j.code === 'bizName', '名称 1–30 字、无 <>');
    ok((await call('/api/biz/check', { ...good, intro: '' })).j.code === 'bizIntro' && (await call('/api/biz/check', { ...good, intro: '字'.repeat(301) })).j.code === 'bizIntro' && (await call('/api/biz/check', { ...good, intro: '字'.repeat(300) })).s === 200, '简介 1–300 字');
    ok((await call('/api/biz/check', { ...good, theme: 'evil', layout: 'x' })).j.theme === 'ivory', '未知主题 / 排版回落默认');
    const prefix = `经典~E~vP~n${NAME}~Dstarleaf.example.com`, mo = (await call('/api/moderate', { text: NAME, prefix })).j; ok(mo.pass, '上链前审核通过（名称 + 域名）');
    const sig = crypto.randomBytes(48).toString('base64').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '').padEnd(88, 'A').slice(0, 88), a = mo.attestation;
    wr('tx-mock.json', { [sig]: { author: A.pubkey, memo: `WTREE1|W|${a.hash}|${a.ts}|${a.sig}|${prefix}|${NAME}` } });
    ok((await call('/api/biz-meta', { sig, ...good }, tk(V))).s >= 400, '非作者不能登记元数据');
    ok((await call('/api/biz-meta', { sig, ...good, url: 'https://other.example.org/' }, tk(A))).j.code === 'bizMismatch', '网址域名须与链上一致');
    ok((await call('/api/biz-meta', { sig, ...good })).s === 401 || (await call('/api/biz-meta', { sig, ...good })).s === 403, '未登录不能登记');
    x = await call('/api/biz-meta', { sig, ...good }, tk(A)); ok(x.s === 200, '作者登记官网 / 简介 / 模板');
    const g = (await call('/api/biz-meta/' + encodeURIComponent(sig))).j; ok(g.url === new URL(URL_).href && g.intro === INTRO && g.name === NAME && !('owner' in g), '公开读取：不含内部字段');
    if (SHOTS) { console.log('screens'); const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
      const page = async (u, lang = 'zh-CN') => { const c = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, locale: lang }); const p = await c.newPage(); const errs = []; p.on('pageerror', e => { errs.push(e.message); console.log('ERR', e.message); }); p.errs = errs;
        await p.route('**/api/img/LOGO*', r => r.fulfill({ contentType: 'image/svg+xml', body: LOGO }));
        await p.goto(Bs + '/?lang=' + lang); await p.evaluate(t => { localStorage.wt_token = t; localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }, u.token); return p; };
      let p = await page(A); await p.goto(Bs + '/?lang=zh-CN#/wish/make'); await p.reload(); await p.waitForSelector('#ckind', { timeout: 90000 });
      ok((await p.$$eval('#ckind option', o => o.map(x => x.value))).includes('biz'), '卡片类型含「企业展示卡」');
      await p.locator('#ckind').scrollIntoViewIfNeeded(); await p.evaluate(() => { const s = document.querySelector('#ckind'); s.size = s.options.length; s.value = 'biz'; window.scrollBy(0, -120); }); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/t240-type-select.png' }); await p.evaluate(() => { document.querySelector('#ckind').size = 0; });
      await p.selectOption('#ckind', 'biz'); await p.waitForTimeout(400);
      await p.fill('#bzname', NAME); await p.fill('#bzurl', URL_); await p.fill('#bzintro', INTRO); await p.click('[data-bzt=navy]'); await p.selectOption('#bzlay', 'left'); await p.setInputFiles('#upC', '/tmp/logo.png').catch(e => console.log('upC', e.message)); await p.waitForTimeout(1500);
      ok(await p.isHidden('#wt') && await p.$eval('#wc2', e => e.value) === '自定义' && await p.$eval('#ctype', e => e.value) === 'folded' && (await p.textContent('#bzdom')).includes('starleaf.example.com'), '表单：隐藏普通文本，封面强制自定义（Logo），折页卡，实时显示域名');
      await p.evaluate(() => { const e = document.querySelector('#bizWrap'); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 60); }); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/t240-form.png' });
      if (await p.isVisible('#pvToggle') && await p.getAttribute('#pvToggle', 'aria-expanded') !== 'true') await p.click('#pvToggle'); await p.waitForTimeout(400);
      await p.locator('#pvBody').scrollIntoViewIfNeeded(); await p.waitForTimeout(400); const pv = await p.textContent('#pvBody');
      ok(pv.includes(NAME) && pv.includes('starleaf.example.com') && pv.includes('外部链接') && await p.$('#pvBody .biz-navy.biz-l-left'), '实时预览：名称 / 简介 / 域名 / 外链提示 / 所选主题');
      await p.screenshot({ path: SHOTS + '/t240-preview.png' });
      const fake = { sig, id: 0, kind: 'biz', cat: '经典', hue: 40, author: A.pubkey, text: NAME, bname: NAME, domain: 'starleaf.example.com', folded: true, cimg: 'LOGO1', inside: 3, cover: 0, likes: 3, blessings: [], likers: [], vis: 'public', deliver: 'tree', ts: Date.now() / 1000, time: Math.floor(Date.now() / 1000) };
      p = await page(V); await p.goto(Bs + '/?lang=zh-CN#/'); await p.reload(); await p.waitForTimeout(5000);
      const id = await p.evaluate(w => { w.likers = new Set(); w.id = S.wishes.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; S.wishes.push(w); WT3D.update(treeWishes().map(lockPaint), openCardPopup, { stress: S.stress, total: S.total }); return w.id; }, fake);
      const jr = await p.evaluate(i => WT3D.jumpTo(i).then(r => !!r), id); await p.waitForTimeout(3500); await p.screenshot({ path: SHOTS + '/t240-tree.png' }); ok(jr, '树上：企业展示卡以 Logo 封面挂在树上（jumpTo 命中）');
      await p.evaluate(s => openCardPopup(S.wishes.find(w => w.sig === s)), sig); await p.waitForSelector('.biz-link a', { timeout: 20000 }); await p.waitForTimeout(800);
      const a2 = await p.$eval('.biz-link a', e => ({ href: e.href, rel: e.rel, t: e.target, txt: e.textContent }));
      ok(a2.href === new URL(URL_).href && /noopener/.test(a2.rel) && /nofollow/.test(a2.rel) && a2.t === '_blank' && a2.txt.includes('starleaf.example.com'), '内页：官网安全外链（noopener nofollow，新窗口，显示域名）');
      ok((await p.textContent('.biz-in')).includes('协作工具') && await p.$('.biz-in.biz-navy.biz-l-left'), '内页：名称 / 简介 / 主题排版');
      await p.screenshot({ path: SHOTS + '/t240-detail-inner.png' });
      ok(!p.errs.length, '无页面错误');
    }
    console.log(`\n✅ ${n} checks passed`);
  } finally { if (browser) await browser.close(); srv.kill(); }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

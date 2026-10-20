// 单张礼品卡附加内容 + 团购卡面定制：数据校验、旧数据兼容、接口、前端组件、领取页渲染。支付 / 上链全部模拟（ADS_MOCK_PAY + data/tx-mock.json），不发任何真实交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), crypto = require('crypto');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SOL1 = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
(async () => {
  console.log('unit'); const tu = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-gfu-')); fs.mkdirSync(tu + '/data'); for (const f of ['batch.js', 'gate.js', 'network.js']) fs.copyFileSync(path.join(D, f), path.join(tu, f));
  const B = require(tu + '/batch.js'), H = 'ab'.repeat(16), mk = o => ({ blessing: '愿你被温柔以待', count: 3, coin: 'SOL', valueUsd: 5, redeemNote: '到店出示', feeUsd: 1, gateName: '星光小屋', ...o });
  ok(B.validate(mk()).ok.face === null && B.validate(mk({ face: {} })).ok.face === null, '未设置卡面 → face=null（默认样式）');
  const f1 = B.validate(mk({ face: { cover: 3, inside: 2, text: ' 内页<b>你好</b>~ ' } })).ok.face; ok(f1.cover === 3 && f1.inside === 2 && f1.text === '内页b你好/b' && f1.cimg === '' && f1.nimg === '', '封面 / 内页模板 + 内页内容（清洗 <>~）');
  ok(B.validate(mk({ face: { cimg: '/api/img/' + H, nimg: '/api/img/' + H } })).ok.face.cimg === '/api/img/' + H, '自定义封面 / 内页图：平台图片地址');
  for (const [f, e, m] of [[{ cover: -1 }, 'face', '负数模板编号'], [{ cover: 1.5 }, 'face', '非整数模板编号'], [{ inside: 'x' }, 'face', '非数字内页编号'], [{ cimg: 'https://evil.com/a.jpg' }, 'attImg', '外链封面图'], [{ nimg: '/api/img/xyz' }, 'attImg', '非哈希内页图'], [{ text: '字'.repeat(141) }, 'face', '内页内容超过 140 字'], [{ text: 'a|b' }, 'face', '内页内容含 |'], [{ text: '保证年化收益' }, 'promise', '内页内容含收益承诺'], ['x', 'face', '卡面不是对象']]) ok(B.validate(mk({ face: f })).error === e, '卡面校验拒绝：' + m);
  ok(JSON.stringify(B.faceHashes({ cimg: '/api/img/' + H, nimg: '' })) === JSON.stringify([H]) && B.faceHashes(null).length === 0, 'faceHashes：服务端据此核验图片已在平台存储');
  { const v = B.validate(mk({ face: { cover: 5 } })).ok, r = B.create('OWN', v, { key: 'sigFACE1', usd: 3 }, 1790000000); B.tick(1790000005, 10); ok(B.pubView(r.batch).face.cover === 5 && B.pubOne(r.batch.id).face.cover === 5, '批次 / 进度视图带 face');
    const code = B.codeFor(r.batch.id, 0); ok(B.peek(code).face.cover === 5, '领取页 peek 带 face（同批次共用）');
    const old = { ...r.batch, id: 'b_' + 'f'.repeat(16) }; delete old.face; B.load().batches[old.id] = old; ok(B.pubView(old).face === null && B.pubOne(old.id).face === null, '旧批次（无 face 字段）→ null，照常显示默认样式'); }
  console.log('backend'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-gfs-')), port = 18931, Bs = 'http://127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data/img', { recursive: true });
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', PRICE_MOCK: '1', BATCH_SHARD: '500' }, stdio: 'ignore' });
  const wr = (f, o) => fs.writeFileSync(path.join(tmp, 'data', f), JSON.stringify(o)), rd = f => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8')); } catch { return {}; } };
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); let j = {}; const tx = await x.text(); try { j = JSON.parse(tx); } catch {} return { s: x.status, j, text: tx }; };
  const mkImg = h => { fs.writeFileSync(tmp + '/data/img/' + h, 'x'); fs.writeFileSync(tmp + '/data/img/' + h + '.json', '{"mime":"image/webp"}'); }, I1 = 'd1'.repeat(16), I2 = 'd2'.repeat(16); [I1, I2].forEach(mkImg);
  let browser; try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const M = (await call('/api/login', { email: 'giftface@test.dev' })).j, R = (await call('/api/login', { email: 'recv@test.dev' })).j, X = (await call('/api/login', { email: 'stranger@test.dev' })).j, tk = u => ({ authorization: 'Bearer ' + u.token });
    // ---- 单张：附加内容 ----
    const atts = [{ type: 'image', url: '/api/img/' + I1 }, { type: 'product', url: 'https://shop.example.com/p/1', title: '香薰蜡烛', cover: '/api/img/' + I2 }];
    let x = await call('/api/gift-att/check', { attachments: atts }); ok(x.s === 200 && x.j.attachments.length === 2 && x.j.attachments[1].sort === 1, '付款前预检：图片 + 商品链接通过，保留顺序');
    for (const [a, e, m] of [[Array.from({ length: 21 }, () => atts[0]), 'attMax', '超过 20 个'], [[{ type: 'image', url: 'https://evil.com/x.jpg' }], 'attImg', '外链图片'], [[{ type: 'image', url: '/api/img/' + 'e'.repeat(32) }], 'attImg', '图片未经平台上传审核'], [[{ type: 'product', url: 'javascript:alert(1)' }], 'attLink', '非法链接'], [[{ type: 'product', url: 'https://10.0.0.1/x' }], 'attLink', '内网链接'], [[{ type: 'product', url: 'https://shop.example.com/a', title: '稳赚收益' }], 'promise', '标题含收益承诺']]) { x = await call('/api/gift-att/check', { attachments: a }); ok(x.s === 400 && x.j.code === e, '单张附加内容被拒：' + m + ' → ' + e); }
    // 模拟一张已上链的礼品卡（moderate 取得真实审核证明，memo 结构与前端一致）
    const mkGift = async (vis = 'P') => { const prefix = `经典~G~v${vis}~dT~T${R.pubkey || SOL1}~Mhi`, text = '生日快乐', mo = (await call('/api/moderate', { text, prefix })).j; assert(mo.pass, 'moderate ' + JSON.stringify(mo)); const a = mo.attestation, sig = crypto.randomBytes(48).toString('base64').replace(/[^1-9A-HJ-NP-Za-km-z]/g, '').padEnd(88, 'A').slice(0, 88);
      wr('tx-mock.json', { ...rd('tx-mock.json'), [sig]: { author: M.pubkey, memo: `WTREE1|W|${a.hash}|${a.ts}|${a.sig}|${prefix}|${text}` } }); return sig; };
    const g1 = await mkGift(); x = await call('/api/gift-sent', { sig: g1, attachments: atts }, tk(M)); ok(x.s === 200 && x.j.ok && !x.j.attError, '礼品卡上链后登记附加内容');
    x = await call('/api/gift-att?sig=' + g1); ok(x.s === 200 && x.j.attachments.length === 2 && x.j.attachments[0].url === '/api/img/' + I1 && x.j.attachments[1].title === '香薰蜡烛', '公开礼品卡：任何人可读取附加内容（详情 / 领取展示）');
    x = await call('/api/gift-sent', { sig: g1, attachments: [atts[0]] }, tk(M)); ok((await call('/api/gift-att?sig=' + g1)).j.attachments.length === 2, '附加内容只登记一次（重复提交不覆盖）');
    const g2 = await mkGift(); x = await call('/api/gift-sent', { sig: g2, attachments: atts }, tk(X)); ok(x.s === 403 && (await call('/api/gift-att?sig=' + g2)).j.attachments.length === 0, '非作者不能为别人的礼品卡登记附加内容');
    const g3 = await mkGift(); x = await call('/api/gift-sent', { sig: g3, attachments: [{ type: 'image', url: 'https://evil.com/a.jpg' }] }, tk(M)); ok(x.s === 200 && x.j.attError === 'attImg' && (await call('/api/gift-att?sig=' + g3)).j.attachments.length === 0, '登记时附加内容不合规：卡片照常登记，附加内容不保存并返回 attError');
    const g4 = await mkGift('L'); x = await call('/api/gift-sent', { sig: g4, password: 'pass1234', attachments: atts }, tk(M)); const lockedRead = await call('/api/gift-att?sig=' + g4), ownerRead = await call('/api/gift-att?sig=' + g4, null, tk(M)), strRead = await call('/api/gift-att?sig=' + g4, null, tk(X));
    ok(lockedRead.j.attachments.length === 0 && lockedRead.j.locked && ownerRead.j.attachments.length === 2 && strRead.j.attachments.length === 0, '上锁礼品卡：未登录 / 陌生人看不到附加内容，作者可见');
    ok((await call('/api/gift-att?sig=' + 'Z'.repeat(70))).j.attachments.length === 0 && (await call('/api/gift-att?sig=bad')).s === 400, '无附加内容的旧卡 → 空列表；非法 sig → 400');
    // ---- 团购：卡面 ----
    const base = o => ({ blessing: '愿你被温柔以待', count: 3, coin: 'SOL', valueUsd: 5, redeemNote: '凭码到店兑换', feeUsd: 1, gateName: '星光小屋', optPublic: false, optAnchor: false, ...o });
    const create = async (b, sig) => { const q = (await call('/api/batch/quote', { count: b.count, coin: b.coin, feeUsd: b.feeUsd }, tk(M))).j; wr('ads-mock-pay.json', { ...rd('ads-mock-pay.json'), [sig]: { signer: M.pubkey, lamports: Math.ceil(q.amount * 1e9) } }); return call('/api/batch/create', { ...b, quote: q.quote, sig }, tk(M)); };
    x = await create(base({ face: { cover: 7, inside: 4, cimg: '/api/img/' + I1, text: '内页：生日快乐' } }), 'MOCKface00001'); ok(x.s === 200 && x.j.batch.face.cover === 7 && x.j.batch.face.cimg === '/api/img/' + I1 && x.j.batch.face.text === '内页：生日快乐', '创建团购：卡面随批次保存');
    const bid = x.j.batch.id;
    x = await create(base({ face: { cimg: '/api/img/' + 'e'.repeat(32) } }), 'MOCKface00002'); ok(x.s === 400 && x.j.code === 'attImg', '卡面图片必须已通过平台上传审核');
    x = await create(base({ face: { text: '保证稳赚收益' } }), 'MOCKface00003'); ok(x.s === 400 && x.j.code === 'promise', '卡面内页内容含收益承诺 → 拒绝');
    x = await create(base(), 'MOCKface00004'); ok(x.s === 200 && x.j.batch.face === null, '不设置卡面 → 默认样式（face=null）');
    for (let i = 0; i < 60; i++) { const v = (await call('/api/batch/' + bid, null, tk(M))).j.batch; if (v?.status === 'done') break; await new Promise(r => setTimeout(r, 500)); }
    const csv = (await call('/api/batch/' + bid + '/csv', null, tk(M))).text, codes = [...csv.matchAll(/"\d+","([0-9A-Z-]{23})"/g)].map(m => m[1]); ok(codes.length === 3, '批次生成 3 个领取码');
    const pk = await Promise.all(codes.map(c => call('/api/batch/peek?code=' + c))); ok(pk.every(p => p.j.face && p.j.face.cover === 7 && p.j.face.text === '内页：生日快乐'), '同一批次所有领取码共用同一套卡面');
    ok((await call('/api/batch/' + bid, null, tk(M))).j.batch.face.inside === 4, '批次进度接口带卡面');
    // ---- 前端 ----
    const app = fs.readFileSync(D + '/public/app.js', 'utf8'); ok(/attBind\('gb'/.test(app) && /attBind\('sg'/.test(app) && /faceBind\('gbx'/.test(app) && /coverGridHtml\(px\)/.test(app) && /\/api\/gift-att\/check/.test(app), '前端：团购与单张共用附加内容组件；团购卡面复用单张封面组件');
    const L = fs.readdirSync(D + '/public/i18n').filter(f => f.endsWith('.json')), miss = []; for (const f of L) { const d = JSON.parse(fs.readFileSync(D + '/public/i18n/' + f, 'utf8')); for (const k of ['gift.att.h', 'gb.face.t', 'gb.face.h', 'gb.face.text', 'gb.face.reset', 'gb.face.def', 'gb.err.face']) if (!d[k] || /还愿|還願|收益/.test(d[k])) miss.push(f + ':' + k); }
    ok(L.length === 16 && !miss.length, '16 种语言新文案齐全、无禁用词 ' + miss.slice(0, 3).join(','));
    const { chromium } = require('playwright'); browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(([tok]) => { localStorage.wt_token = tok; localStorage.gq_guide_dismissed = '1'; localStorage.wt_terms = '1'; }, [M.token]); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(Bs + '/#/gift'); await pg.waitForSelector('#sgal', { state: 'attached', timeout: 30000 }); await pg.waitForSelector('#giftWrap:not([hidden])', { timeout: 15000 });
    ok(/0\/20/.test(await pg.textContent('#sgatc')), '单张模式：附加内容区 + 0/20 计数');
    const addLink = async (u, ti) => { await pg.click('#sgap'); await pg.fill('#gpu', u); await pg.fill('#gpt', ti); await pg.click('#gpf button[type=submit]'); await pg.waitForSelector('#gpf', { state: 'hidden' }); };
    await addLink('https://shop.example.com/a', '商品A'); await addLink('https://shop.example.com/b', '商品B');
    ok(/2\/20/.test(await pg.textContent('#sgatc')) && (await pg.$$('#sgal li')).length === 2, '单张：添加 2 个商品链接 → 2/20');
    await pg.click('#sgal [data-mv="0"][data-d="1"]'); ok((await pg.textContent('#sgal li:first-child b')).includes('商品B'), '单张：▼ 调整顺序');
    await pg.click('#sgal [data-rm="0"]'); ok((await pg.$$('#sgal li')).length === 1 && /1\/20/.test(await pg.textContent('#sgatc')), '单张：删除 → 1/20');
    await pg.click('#pvToggle').catch(() => {}); await pg.fill('#gnt', '生日快乐'); await pg.waitForFunction(() => /商品A/.test(document.querySelector('#pvBody')?.textContent || ''), null, { timeout: 10000 }).catch(() => {}); const pvt = await pg.textContent('#pvBody'); ok(/商品A/.test(pvt), '单张实时预览显示附加内容 ' + (/商品A/.test(pvt) ? '' : pvt.slice(0, 200) + ' errs=' + errs.join('|')));
    await pg.goto(Bs + '/#/gift/batch'); await pg.waitForSelector('#gbxface', { timeout: 30000 }); await pg.fill('#gbb', '愿你天天开心'); await pg.fill('#gbg', '星光小屋');
    ok(/0\/20/.test(await pg.textContent('#gbatc')) && (await pg.$$('#gbxcovers [data-cover]')).length > 5 && (await pg.$$('#gbxinsides [data-inside]')).length > 3 && await pg.$('#gbxupC') && await pg.$('#gbxupN'), '团购模式：封面模板 / 自定义封面 / 内页模板 / 自定义内页 + 附加内容');
    const src0 = await pg.getAttribute('#gbxpv .gb-fc img', 'src'); await pg.click('#gbxcovers [data-cover="9"]'); await pg.click('#gbxinsides [data-inside="2"]'); await pg.fill('#gbxtext', '内页祝福：一路顺风');
    const src1 = await pg.getAttribute('#gbxpv .gb-fc img', 'src'); ok(src0 !== src1 && /一路顺风/.test(await pg.textContent('#gbxpv')) && /愿你天天开心/.test(await pg.textContent('#gbxpv')) && await pg.getAttribute('#gbxcovers [data-cover="9"]', 'aria-pressed') === 'true', '团购实时预览：封面切换、内页内容与祝福同步');
    await pg.click('#gbpv'); ok(await pg.$('#gbpvbox .gb-face-v') && /一路顺风/.test(await pg.textContent('#gbpvbox')), '团购「预览领取页」按所选卡面渲染');
    await pg.reload(); await pg.waitForSelector('#gbxface'); ok(await pg.getAttribute('#gbxcovers [data-cover="9"]', 'aria-pressed') === 'true' && (await pg.inputValue('#gbxtext')).includes('一路顺风'), '团购卡面写入草稿，刷新后恢复');
    await pg.goto(Bs + '/#/claim/' + codes[0]); await pg.waitForSelector('.gb-claimcard .gb-face-v', { timeout: 20000 }); ok((await pg.getAttribute('.gb-claimcard .gb-fc img', 'src')).endsWith('/api/img/' + I1) && /内页：生日快乐/.test(await pg.textContent('.gb-claimcard')), '领取页按批次卡面渲染（自定义封面 + 内页内容）');
    const old = (await create(base(), 'MOCKface00005')).j.batch.id; for (let i = 0; i < 60; i++) { if ((await call('/api/batch/' + old, null, tk(M))).j.batch?.status === 'done') break; await new Promise(r => setTimeout(r, 500)); }
    const oc = [...(await call('/api/batch/' + old + '/csv', null, tk(M))).text.matchAll(/"\d+","([0-9A-Z-]{23})"/g)][0][1]; await pg.goto(Bs + '/#/claim/' + oc); await pg.waitForSelector('.gb-claimcard', { timeout: 20000 }); ok(!(await pg.$('.gb-claimcard .gb-face-v')), '未设置卡面的批次：领取页保持默认样式');
    await pg.goto(Bs + '/#/gift/batch/' + bid); await pg.waitForSelector('#gbpg .gb-face-v', { timeout: 20000 }); ok(true, '批次进度页按所选卡面渲染');
    // ---- t221u：菜单「制作我的心愿卡」+ 制作页礼品卡单张 / 团购 ----
    const cur = () => pg.$$eval('#menu nav a.cur, #topnav a.cur', a => a.map(x => x.getAttribute('href')));
    const mkl = await pg.$$eval('#menu nav a, #topnav a', a => a.map(x => x.getAttribute('href') + '=' + x.textContent.trim())); ok(!mkl.some(x => x.startsWith('#/gift=')) && mkl.filter(x => x.startsWith('#/wish/make=')).length === 2 && mkl.filter(x => x.startsWith('#/wish/make=')).every(x => /制作我的心愿卡|Make my wish card/.test(x)), '抽屉菜单与桌面顶栏：「礼品卡」换成「制作我的心愿卡」→ #/wish/make');
    ok(await pg.$eval('#menu nav a[href="#/wish/make"] svg.mi', () => true).catch(() => false) && await pg.$eval('#menu nav a[href="#/wish"] svg.mi', () => true).catch(() => false) && !(await pg.$('#menu .mi-hash')), '菜单图标：制作心愿卡与「我的星愿」都是金色线条图标（去掉绿色 #）');
    await pg.goto(Bs + '/#/'); await pg.waitForSelector('.gb-home', { state: 'attached', timeout: 30000 }); ok(await pg.$eval('.gb-home', a => a.getAttribute('href')) === '#/wish/make', '首页入口改为「制作我的心愿卡」');
    await pg.goto(Bs + '/#/gift'); await pg.waitForFunction(() => location.hash === '#/wish/make?gift=single' && document.querySelector('#ckind')?.value === 'gift', null, { timeout: 15000 });
    ok(await pg.$eval('#gseg', e => !e.hidden && e.querySelector('.on').dataset.gm === 'single') && await pg.$eval('#giftWrap', e => !e.hidden) && await pg.$eval('#gbmode', e => e.hidden), '#/gift → 制作页预选礼品卡，出现「单张 / 团购」切换，默认单张（原表单）');
    ok((await cur()).every(h => h === '#/wish/make') && (await cur()).length >= 1, '制作页：菜单高亮「制作我的心愿卡」');
    await pg.click('#gseg [data-gm=batch]'); await pg.waitForSelector('#gbmode #gbf', { timeout: 10000 }); ok(await pg.$eval('#giftWrap', e => !e.offsetParent) && await pg.$eval('#gbxface', () => true), '选团购：显示团购完整表单（复用 gbPage / gbBind），原表单隐藏');
    ok(await pg.$$eval('#gbf', a => a.length) === 1, '团购组件只有一份（不重复渲染）');
    await pg.click('#gseg [data-gm=single]'); ok(await pg.$eval('#giftWrap', e => !!e.offsetParent) && await pg.$eval('#gbmode', e => e.hidden), '切回单张：恢复原表单');
    await pg.click('#gseg [data-gm=batch]'); await pg.selectOption('#ckind', 'wish'); ok(await pg.$eval('#gseg', e => e.hidden) && await pg.$eval('#gbmode', e => e.hidden) && await pg.$eval('#wt', e => !!e.offsetParent), '换成其他类型：切换隐藏，恢复原表单');
    await pg.goto(Bs + '/#/gift/batch'); await pg.waitForFunction(() => location.hash === '#/wish/make?gift=batch', null, { timeout: 15000 }); await pg.waitForSelector('#gbmode #gbf', { timeout: 15000 }); ok(await pg.$eval('#gseg .on', e => e.dataset.gm) === 'batch', '#/gift/batch → 制作页预选礼品卡 · 团购');
    await pg.goto(Bs + '/#/gift/batch/' + bid); await pg.waitForSelector('#gbpg', { timeout: 15000 }); ok((await pg.evaluate(() => location.hash)) === '#/gift/batch/' + bid && (await cur()).includes('#/wish/make'), '#/gift/batch/<id> 进度页不变，菜单高亮制作项');
    await pg.goto(Bs + '/#/claim/ABCD-EFGH'); await pg.waitForTimeout(500); ok((await pg.evaluate(() => location.hash)) === '#/claim/ABCD-EFGH' && (await cur()).includes('#/wish/make'), '#/claim/<code> 领取页不变，菜单高亮制作项');
    ok(!errs.length, '页面无 JS 错误 ' + errs.slice(0, 2).join(' | '));
  } finally { await browser?.close(); srv.kill(); }
  console.log(`\n✅ ${n} checks passed`); process.exit(0);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });

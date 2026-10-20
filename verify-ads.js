// 合作卡验证：评分函数、全局排名（每商家上限 / 同分按先上线）、分页广告位（5,10,…,100）、幂等追加、追加后立即重算、
// 以及后端接口与前端 feed 规则。仅使用模拟的支付核验——不发任何真实链上交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); }; const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const SOL = 1e9, H = 3600;
// ---------- 1. 纯函数（临时数据目录，不写仓库 data/）----------
const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-adsu-')); fs.mkdirSync(path.join(tmpd, 'data'));
for (const f of ['ads.js', 'network.js']) fs.copyFileSync(path.join(__dirname, f), path.join(tmpd, f)); const A = require(path.join(tmpd, 'ads.js'));
console.log('score');
ok(near(A.score(1 * SOL, 0, 0), 1) && near(A.score(1 * SOL, 0, 24 * H), 1 / 1.72) && near(A.score(1 * SOL, 0, 72 * H), 1 / 3.16) && near(A.score(1 * SOL, 0, 168 * H), 1 / 6.04), '默认 rate 0.03：1 SOL 在 0h/24h/72h/7d = 1 / 0.581 / 0.316 / 0.166');
ok(near(A.score(1 * SOL, 0, 1000 * H), 0.1) && near(A.score(2 * SOL, 0, 1000 * H), 0.2), '得分下限 = totalBid × 0.1（长期不追加也不会归零）');
ok(near(A.score(1 * SOL, 0, 10 * H, { rate: 0.1, floor: 0.1 }), 0.5), 'rate 可配置：rate 0.1、10h → 0.5');
ok(A.score(1 * SOL, 100, 50) === 1, '未来的 launchAt 不产生负时长（decay ≤ 1）');
console.log('rank / cap / tie-break');
const mk = (id, owner, bid, launchAt) => ({ id, owner, enabled: true, totalBid: bid * SOL, launchAt });
const R = A.rankAds([mk('a', 'm1', 1, 0), mk('b', 'm2', 2, 0), mk('c', 'm3', 1, 0)], 0);
ok(R.map(x => x.id).join() === 'b,a,c', '得分高者在前；同分（a、c）上线时间相同时按 id 稳定排序');
ok(A.rankAds([mk('x', 'm', 1, 5), mk('y', 'm', 1, 3)], 1e9).map(x => x.id).join() === 'y,x', '同分（均触底）：早上线（链上时间更早）排前');
const many = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => mk(id, 'big', 10 - i, 0)).concat([mk('o1', 'small', 1, 0)]);
const RC = A.rankAds(many, 0); ok(RC.filter(x => x.owner === 'big').length === 3 && RC.map(x => x.id).join() === 'p1,p2,p3,o1', '每商家最多 3 张参与排名（默认 cap=3），超出者不占位');
ok(A.rankAds(many, 0, { rate: 0.03, floor: 0.1, cap: 1 }).length === 2, 'cap 可配置');
ok(A.rankAds([{ ...mk('d', 'm', 5, 0), enabled: false }, mk('z', 'm', 0, 0)], 0).length === 0, '被运营下架 / 无出价的卡不参与排名');
console.log('slots / paging');
A.reset(); const d0 = A.load(); const now = 2000000000;
for (let i = 1; i <= 45; i++) d0.ads['ad' + String(i).padStart(2, '0')] = { id: 'ad' + String(i).padStart(2, '0'), owner: 'own' + i, brand: '', title: 'T' + i, text: 'x', cover: 0, image: '', mode: 'inline', url: '', enabled: true, launchAt: now, totalBid: (100 - i) * SOL, bids: [] };
A.markDirty(); let p1 = A.pageSlots(1, now), p2 = A.pageSlots(2, now), p3 = A.pageSlots(3, now), p4 = A.pageSlots(4, now);
ok(p1.slots.length === 20 && p1.slots.map(s => s.pos).join() === Array.from({ length: 20 }, (_, i) => (i + 1) * 5).join(), '第 1 页：20 个广告位，位置 5,10,…,100');
ok(p1.slots[0].rank === 1 && p1.slots[19].rank === 20 && p2.slots[0].rank === 21 && p2.slots[19].rank === 40, '第 1 页取名次 1–20，第 2 页取 21–40');
ok(p3.slots.length === 5 && p3.slots[0].rank === 41 && p3.slots[4].pos === 25 && !p3.hasMoreAds && p2.hasMoreAds, '第 3 页只有 5 张广告（名次 41–45），其余位置由自然卡填充；之后无更多广告');
ok(p4.slots.length === 0 && p4.ranked === 45, '无限页：超出名次范围的页没有广告位');
ok(p1.slots[0].ad.id === 'ad01' && !('score' in p1.slots[0].ad) && !('totalBid' in p1.slots[0].ad), '公开广告位数据不含得分 / 出价');
console.log('credit / idempotency / recompute');
A.reset(); const d1 = A.load(); d1.ads.m1 = { id: 'm1', owner: 'OWN', brand: '', title: 'M1', text: 'x', cover: 0, image: '', mode: 'inline', url: '', enabled: true, launchAt: now - 72 * H, totalBid: 1 * SOL, bids: [], createdAt: now - 72 * H };
d1.ads.m2 = { ...d1.ads.m1, id: 'm2', owner: 'OTHER', totalBid: 1.2 * SOL, launchAt: now - 72 * H + 10 };
const ledger = { sigA_test0001: { signer: 'OWN', lamports: 0.5 * SOL }, sigB_test0001: { signer: 'EVIL', lamports: 5 * SOL }, sigSmall_test0001: { signer: 'OWN', lamports: 0.001 * SOL } };
A.setVerifier(async (sig, signer) => ledger[sig] && ledger[sig].signer === signer ? { lamports: ledger[sig].lamports, time: now } : null);
(async () => {
  A.markDirty(); let b = A.board(now); ok(b.byId.get('m2').rank === 1 && b.byId.get('m1').rank === 2, '追加前：m2(1.2) 排第 1，m1(1.0) 排第 2');
  const before = A.mine('OWN', now).ads[0].score; let r = await A.credit('m1', 'OWN', 'sigA_test0001', 'topup', now);
  ok(r.ok && !r.dup && near(r.ad.totalBid, 1.5), '追加 0.5 SOL：累计出价 1 → 1.5');
  ok(r.ad.rank === 1 && A.board(now).byId.get('m1').rank === 1, '追加后立即重算（不等 15 分钟）：m1 升至第 1');
  ok(near(r.ad.score, 1.5 / 3.16) && r.ad.score > before && near(before, 1 / 3.16), '衰减从首次上线起算：追加后得分立即 = 1.5 × decay(72h)');
  r = await A.credit('m1', 'OWN', 'sigA_test0001', 'topup', now + 5); ok(r.ok && r.dup && near(A.load().ads.m1.totalBid, 1.5 * SOL) && A.load().ads.m1.bids.length === 1, '同一交易签名重复提交（补单 / 重试）不重复入账');
  ok((await A.credit('m1', 'OWN', 'sigB_test0001', 'topup', now)).error === 'verify', '签名者不是商家地址 → 核验失败，不入账');
  ok((await A.credit('m1', 'EVIL', 'sigB_test0001', 'topup', now)).error === 'owner', '非所有者不能给别人的广告追加');
  ok((await A.credit('m1', 'OWN', 'sigSmall_test0001', 'topup', now)).error === 'amount', '低于最小追加额（默认 0.01 SOL）→ 拒绝');
  ok((await A.credit('m1', 'OWN', 'nope-sig-1234', 'topup', now)).error === 'verify', '链上不存在的交易 → 拒绝');
  const [x, y] = await Promise.all([A.credit('m1', 'OWN', 'sigC_test0001', 'topup', now), A.credit('m1', 'OWN', 'sigC_test0001', 'topup', now)]); ledger.sigC_test0001 = { signer: 'OWN', lamports: 0.2 * SOL };
  ok(x.error === 'verify' || y.error === 'verify' || x.error === 'busy' || y.error === 'busy', '并发提交同一签名：串行化处理');
  const est = A.estimate({ totalBid: 1.0, launchAt: now - 72 * H }, 0.5, [0.5, 0.4, 0.3], now, A.cfg()); ok(est.rank === 1 + [0.5, 0.4, 0.3].filter(s => s > est.score).length, '预估名次 = 1 + 得分板中高于预估得分的数量');
  const lr = await A.launch('NEW', { id: 'fresh', title: 'F', text: 'x' }, 'sigL_test0001', now); ok(lr.error === 'verify', '首次上线：支付核验失败则不创建广告');
  ledger.sigL_test0001 = { signer: 'NEW', lamports: 0.3 * SOL }; const lr2 = await A.launch('NEW', { id: 'fresh', title: 'F', text: 'x' }, 'sigL_test0001', now); ok(lr2.ok && A.load().ads.fresh.launchAt === now && near(lr2.ad.totalBid, 0.3), '首次出价 = 首次上线：创建广告、launchAt = 首笔出价时间');
  ok((await A.launch('NEW', { id: 'fresh', title: 'F', text: 'x' }, 'sigL2', now)).error === 'exists' && (await A.launch('NEW', { id: 'fresh2', title: 'F', text: 'x' }, 'sigL_test0001', now)).error === 'used', '广告 id 不可重复；已用签名不可再次上线');
  ok(A.setConfig({ rate: 0.06 }).rate === 0.06 && near(A.score(1 * SOL, 0, 24 * H), 1 / 2.44), '管理员改 rate 后立即生效');
  ok((() => { try { A.setConfig({ cap: 0 }); return false; } catch { return true; } })(), '非法配置被拒绝');
  A.setConfig({ rate: 0.03 });
  // 永久：很久以后仍在排名中（不会过期 / 消失）
  const far = now + 3650 * 86400; ok(A.board(far).byId.has('m1') && A.mine('OWN', far).ads[0].score > 0, '广告卡永久存在：10 年后仍参与排名，得分触底为 totalBid × 0.1');
  // ---------- 2. 后端接口（模拟支付）----------
  console.log('backend API');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ads-')), port = 19000 + Math.floor(Math.random() * 900);
  for (const f of fs.readdirSync(__dirname)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(__dirname, f), path.join(tmp, f));
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(tmp, 'node_modules')); fs.symlinkSync(path.join(__dirname, 'public'), path.join(tmp, 'public')); fs.mkdirSync(path.join(tmp, 'data'));
  const srv = cp.spawn(process.execPath, ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', ADS_MOCK_PAY: '1', D1_API_TOKEN: '' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port, call = async (u, body, o = {}) => { const r = await fetch(B + u, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(o.tok ? { authorization: 'Bearer ' + o.tok } : {}), ...(o.adm ? { 'x-admin-key': 'k-test' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const mockWrite = (f, o) => fs.writeFileSync(path.join(tmp, 'data', f), JSON.stringify(o));
  try { for (let i = 0; i < 60; i++) { try { await fetch(B + '/api/nonce'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const M = (await call('/api/login', { email: 'merchant@test.dev' })).j, O = (await call('/api/login', { email: 'other@test.dev' })).j;
    ok((await call('/api/ads?page=1')).j.slots.length === 0, '无广告：第 1 页没有广告位（整页由自然卡填充）');
    ok((await call('/api/admin/ads', { id: 'x1', title: 'T', text: 'T' })).s === 403, '管理接口无 ADMIN_KEY → 403');
    ok((await call('/api/admin/ads', { id: 'ext1', title: 'T', text: 'T', mode: 'external', url: 'http://a.example/x' }, { adm: 1 })).s === 400 && (await call('/api/admin/ads', { id: 'ext1', title: 'T', text: 'T', mode: 'external', url: 'https://bit.ly/abc' }, { adm: 1 })).s === 400, '外链必须 https 且过钓鱼/短链黑名单');
    let r = await call('/api/admin/ads', { id: 'shop-a', owner: M.pubkey, brand: '示例', title: '示例合作 A', text: '示例合作内容', bidSol: 1 }, { adm: 1 }); ok(r.s === 200 && r.j.ad.totalBid === 1, '运营创建合作卡（含演示出价）');
    await call('/api/admin/ads', { id: 'shop-b', owner: O.pubkey, title: '示例合作 B', text: '内容', bidSol: 1.2 }, { adm: 1 });
    r = await call('/api/ads?page=1'); ok(r.j.slots.length === 2 && r.j.slots[0].pos === 5 && r.j.slots[0].ad.id === 'shop-b' && r.j.slots[1].pos === 10 && !('score' in r.j.slots[0].ad), '公开分页接口：名次 1→位置 5，名次 2→位置 10，不含得分');
    ok((await call('/api/ads/mine')).s === 401 && (await call('/api/ads/rank?id=shop-a')).s === 401, '我的广告 / 名次接口需登录会话');
    r = await call('/api/ads/mine', null, { tok: M.token }); ok(r.j.ads.length === 1 && r.j.ads[0].id === 'shop-a' && r.j.ads[0].rank === 2 && r.j.cfg.minTopupSol === 0.01 && r.j.receive, '商家只看到自己的广告：名次 2、配置、收款地址');
    ok((await call('/api/ads/rank?id=shop-a', null, { tok: O.token })).s === 403 && (await call('/api/ads/rank?id=shop-a', null, { tok: M.token })).j.ad.score > 0, '名次 / 得分仅所有者可读（他人 403）');
    r = await call('/api/ads/pay', { id: 'shop-a', sol: 0.005 }, { tok: M.token }); ok(r.s === 400 && r.j.code === 'amount', '低于最小追加额 → amount');
    ok((await call('/api/ads/pay', { id: 'shop-a', sol: 0.1 }, { tok: O.token })).s === 403, '不能给他人的广告追加');
    r = await call('/api/ads/pay', { id: 'shop-a', sol: 0.5 }, { tok: M.token }); ok(r.s === 200 && r.j.ad.totalBid === 1.5 && r.j.ad.rank === 1 && r.j.signature, '追加 0.5 SOL（模拟支付）：累计 1.5，立即升至第 1');
    const sig1 = r.j.signature; ok((await call('/api/ads/credit', { id: 'shop-a', sig: sig1 }, { tok: M.token })).j.dup === true && (await call('/api/ads/mine', null, { tok: M.token })).j.ads[0].totalBid === 1.5, '用同一签名补单：幂等，不重复入账');
    mockWrite('ads-mock-flags.json', { failCredit: true }); r = await call('/api/ads/pay', { id: 'shop-a', sol: 0.2 }, { tok: M.token }); ok(r.j.code === 'record' && r.j.signature && (await call('/api/ads/mine', null, { tok: M.token })).j.ads[0].totalBid === 1.5, '已付款但记账失败：返回签名与 record 错误，累计出价未变');
    mockWrite('ads-mock-flags.json', {}); const lost = r.j.signature; r = await call('/api/ads/credit', { id: 'shop-a', sig: lost }, { tok: M.token }); ok(r.s === 200 && !r.j.dup && r.j.ad.totalBid === 1.7, '补单：按交易签名核验后入账（1.5 → 1.7）');
    ok((await call('/api/ads/credit', { id: 'shop-a', sig: lost }, { tok: O.token })).s === 403 && (await call('/api/ads/credit', { id: 'shop-a', sig: 'MOCKdeadbeef0000' }, { tok: M.token })).s === 400, '他人 / 不存在的签名不能补单');
    mockWrite('ads-mock-pay.json', { ...JSON.parse(fs.readFileSync(path.join(tmp, 'data/ads-mock-pay.json'))), MOCKforeign0001: { signer: O.pubkey, lamports: 1e9 } }); ok((await call('/api/ads/credit', { id: 'shop-a', sig: 'MOCKforeign0001' }, { tok: M.token })).s === 400, '签名者不是商家地址的支付不能入账');
    r = await call('/api/admin/ads/config', { rate: 0.05, cap: 2, intervalMin: 30, minTopupSol: 0.02, floor: 0.2 }, { adm: 1 }); ok(r.s === 200 && r.j.cfg.cap === 2 && r.j.cfg.minTopupSol === 0.02, '管理员配置：rate / floor / 间隔 / 每商家上限 / 最小追加额');
    ok((await call('/api/admin/ads/config', { rate: -1 }, { adm: 1 })).s === 400 && (await call('/api/admin/ads/config', { cap: 3 })).s === 403, '非法配置 400；无 ADMIN_KEY 403');
    r = await call('/api/admin/ads', null, { adm: 1 }); ok(r.j.ads.length === 2 && r.j.ads[0].score > 0 && r.j.ads[0].owner, '管理员列表含得分 / 名次 / 所有者');
    await call('/api/track', { ev: 'ad_click', id: 'AD:shop-a', pos: 5, rank: 1 }); ok((await call('/api/admin/ads', null, { adm: 1 })).j.stats.ad_click['shop-a|r1|p5'] === 1, '点击统计仍按 id|名次|位置聚合');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { srv.kill(); }
  // ---------- 3. 前端 feed 规则（原样取自 app.js）----------
  try { const src = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'), a = src.indexOf('function buildFeedItems'), b = src.indexOf('function initFeed');
    const build = new Function('FEED_PAGE', src.slice(a, src.indexOf('function loadAds')) + '; return buildFeedItems;')(100); const org = k => Array.from({ length: k }, (_, i) => ({ sig: 'o' + i }));
    const slots = (p, k) => ({ slots: Array.from({ length: k }, (_, i) => ({ pos: (i + 1) * 5, rank: (p - 1) * 20 + i + 1, ad: { id: 'a' + ((p - 1) * 20 + i + 1) } })) });
    let r = build(org(500), { 1: slots(1, 20), 2: slots(2, 20) }, 2); ok(r.items.length === 200 && r.items.filter(x => x.t === 'ad').length === 40 && r.used === 160, '2 页满额：每页 100 张，20 个广告位 + 80 张自然卡');
    ok(r.items.slice(0, 100).every((x, i) => (x.t === 'ad') === ((i + 1) % 5 === 0)) && r.items[4].ad.id === 'a1' && r.items[99].ad.id === 'a20' && r.items[104].ad.id === 'a21', '广告位于第 5,10,…,100 位；第 2 页从名次 21 开始');
    r = build(org(500), { 1: slots(1, 3) }, 1); ok(r.items.length === 100 && r.items.filter(x => x.t === 'ad').length === 3 && r.items[4].t === 'ad' && r.items[9].t === 'ad' && r.items[14].t === 'ad' && r.items[19].t === 'w' && r.used === 97, '广告不足：空位由自然卡填充，每页仍为 100 张');
    r = build(org(500), { 1: slots(1, 0) }, 1); ok(r.items.length === 100 && r.items.every(x => x.t === 'w'), '无广告：整页 100 张自然卡（feed 不变）');
    r = build(org(12), { 1: slots(1, 5) }, 1); ok(r.items.length === 12 + 5 && r.items.filter(x => x.t === 'ad').length === 5 && r.items[4].t === 'ad', '自然卡不足一页：广告仍全部展示（永久存在），不凭空补自然卡');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
  console.log(process.exitCode ? '\n❌ failed' : `\n✅ ${n} checks passed`);
})();

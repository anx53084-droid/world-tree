// 门卡一期验证：编码/解码、到期、撤销、访问判定、领取（复核/冷却/一人一次）、到期提醒、批量发放、后端 API 双重校验。
// 全程不上链：纯函数测试 + 在临时目录启动服务器（GATE_MOCK_STATS=1，统计来自模拟文件，不读链、不发交易）。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
const Gate = require('./gate'), Soc = require('./social');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const SOL = ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'Vote111111111111111111111111111111111111111', '11111111111111111111111111111112'];
// ---- 1. 编码 / 解码（前端 parseOpt/encKind 原文 + 服务端 parseKind）----
console.log('encode/decode');
const src = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'), a = src.indexOf('const parseOpt'), b = src.indexOf('const locLabel');
const fe = new Function('CATS', 'esc', src.slice(a, b) + '; return { parseOpt, encKind };')({ 经典: 0, 风景: 1 }, x => x);
const K = { kind: 'gate', gateId: 'growth', name: '成长', to: SOL[0], expireAt: 4102444800, hash: Gate.sha16('benefit') };
const pre = fe.encKind('经典', K, '~K03'), o = fe.parseOpt(pre);
ok(o.kind === 'gate' && o.gateId === 'growth' && o.gname === '成长' && o.to === SOL[0] && o.expireAt === 4102444800 && o.cover === 3, '前端 encKind→parseOpt 往返（含 ~K 封面）: ' + pre.slice(0, 40) + '…');
const sk = Soc.parseKind(pre); ok(sk.kind === 'gate' && sk.gateId === 'growth' && sk.expireAt === 4102444800 && !Soc.validate(sk), '服务端 parseKind/validate 通过');
ok(Buffer.byteLength(pre + '|' + 'x'.repeat(100)) < 600, 'memo 长度在 600 字节内');
ok(fe.parseOpt(fe.encKind('经典', { ...K, expireAt: 0 }, '')).expireAt === 0, '永久（缺省 ~e）= 0');
ok(Soc.validate({ ...sk, gateId: 'Bad Id' }) === 'gateId' && Soc.validate({ ...sk, to: 'nope' }) === 'giftTo' && Soc.validate({ ...sk, expireAt: 5 }) === 'gateExp' && Soc.validate({ ...sk, hash: 'zz' }) === 'field', '非法编号/地址/过期/哈希被拒绝');
for (const old of ['经典', '经典~S~vP~tA~iB', '经典~G~vP~dT~T' + SOL[0] + '~Mhi', '物质类~H~vP~Dx.com~P1', '经典~F03~C' + 'a'.repeat(32)]) ok(fe.parseOpt(old).kind !== 'gate' && Soc.parseKind(old).kind !== 'gate', '旧编码不受影响: ' + old.slice(0, 20));
// ---- 2. 到期 / 撤销 / 访问判定 ----
console.log('expiry / revoke / access');
const now = 1800000000, d = Gate.seed(Gate.load()); d.cards = {}; d.claimable = {}; d.claims = {};
const c1 = Gate.issue(d, { gateId: 'growth', name: '成长', owner: SOL[0], issuer: SOL[1], expireAt: now + 100, benefit: 'x' }, now);
ok(Gate.check(d, [SOL[0]], 'growth', now).code === 'OK', '持有有效卡 → OK');
ok(Gate.check(d, [SOL[0]], 'growth', now + 100).code === 'EXPIRED', '到期时间戳到达 → EXPIRED（边界含等于）');
ok(Gate.check(d, [SOL[2]], 'growth', now).code === 'NO_GATE', '未持有 → NO_GATE');
ok(Gate.check(d, [SOL[2]], 'growth', now, c1.id).code === 'NOT_OWNER', '他人卡号 → NOT_OWNER');
ok(Gate.check(d, [SOL[0]], 'other', now).code === 'NO_GATE', '门卡编号不匹配 → NO_GATE');
const perm = Gate.issue(d, { gateId: 'perm', name: 'P', owner: SOL[0], issuer: SOL[1], expireAt: 0 }, now); ok(Gate.check(d, [SOL[0]], 'perm', now + 9e8).ok, 'expireAt=0 永久有效');
ok(Gate.revoke(d, c1.id, SOL[2], 'x', now).code === 'forbidden', '非发行方不能撤销');
ok(!!Gate.revoke(d, c1.id, SOL[1], '违规', now).card && Gate.check(d, [SOL[0]], 'growth', now).code === 'REVOKED', '发行方撤销 → REVOKED（优先于未到期）');
const c2 = Gate.issue(d, { gateId: 'z', name: 'Z', owner: SOL[2], issuer: 'admin', expireAt: now + 10 }, now); ok(!!Gate.revoke(d, c2.id, 'admin', '', now).card, '管理员可撤销');
const ev = '0xAbCdEf0123456789aBcDeF0123456789abcdef01', c3 = Gate.issue(d, { gateId: 'e', name: 'E', owner: ev, issuer: 'admin', expireAt: 0 }, now); ok(Gate.check(d, [ev.toLowerCase()], 'e', now).ok, 'EVM 地址大小写不敏感');
// ---- 3. 规则 / 领取 ----
console.log('rules / claim');
const R = d.rules.growth; ok(d.rules.first_light.enabled && R.enabled && ['resonance', 'monthly', 'event'].every(k => !d.rules[k].enabled) && Object.keys(d.rules).length === 5 && JSON.stringify(Gate.unlockIds(d, 'treehole')) === JSON.stringify(['first_light', 'growth', 'resonance', 'monthly']), '5 条规则：初心/成长启用，共鸣/月度/活动默认停用；无重复，4 张解锁树洞');
ok(d.rules.resonance.cond.blessings === 10 && d.rules.resonance.validity.days === 180 && d.rules.monthly.cond.monthWishes === 3 && d.rules.monthly.validity.extraDays === 30, '共鸣：10 祝福/180 天；月度：月内 3 张/月底+30 天');
ok(!Gate.evalRule(R, { wishes: 4 }).ok && Gate.evalRule(R, { wishes: 5 }).ok, '条件 wishes ≥ 5');
ok(Gate.evalRule({ cond: { mode: 'any', wishes: 5, blessings: 3 } }, { wishes: 0, blessings: 3 }).ok && !Gate.evalRule({ cond: { mode: 'all', wishes: 5, blessings: 3 } }, { wishes: 9, blessings: 2 }).ok, 'any / all 组合');
ok(Gate.expireFor({ validity: { type: 'days', days: 180 } }, now) === now + 180 * 86400 && Gate.expireFor({ validity: { type: 'permanent' } }, now) === 0 && Gate.expireFor({ validity: { type: 'monthEnd', extraDays: 30 } }, now) === Gate.monthEnd(now) + 30 * 86400, '有效期：N 天 / 永久 / 月底+30 天');
const U = SOL[0] + 'x'; d.rules.growth.enabled = true;
ok(Gate.scan(d, U, { wishes: 0 }, now).length === 0 && !d.claimable[U], '条件未满足 → 无可领取');
ok(Gate.scan(d, U, { wishes: 5 }, now).length === 2 && d.claimable[U].growth.expiresAt === now + 30 * 86400, '满足 → 生成 claimable，资格 30 天');
ok(Gate.scan(d, U, { wishes: 5 }, now + 1).length === 0, '重复扫描不重复生成');
ok(Gate.claim(d, U, 'growth', { wishes: 3 }, now).code === 'NOT_MET' && !d.claimable[U]?.growth, '领取前复核：条件不再满足 → 拒绝并移除');
Gate.scan(d, U, { wishes: 5 }, now); const cl = Gate.claim(d, U, 'growth', { wishes: 5 }, now + 5);
ok(cl.card && cl.card.expireAt === 0 && cl.card.status === 'active' && !d.claimable[U]?.growth, '领取成功：写入记录、移除 claimable、永久有效');
ok(Gate.scan(d, U, { wishes: 9 }, now + 9).filter(x => x.ruleId === 'growth').length === 0 && Gate.claim(d, U, 'growth', { wishes: 9 }, now + 9).code === 'CLAIMED', '每人每规则限领 1 张');
d.rules.first_light.enabled = true; Gate.scan(d, U, { wishes: 9 }, now + 10); ok(Gate.claim(d, U, 'first_light', { wishes: 9 }, now + 10).code === 'COOLDOWN', '全局冷却：24 小时内最多领 1 张');
ok(Gate.claim(d, U, 'first_light', { wishes: 9 }, now + 5 + 86400 + 1).card, '冷却结束后可领第二张');
Gate.scan(d, 'late', { wishes: 9 }, now); ok(Gate.claim(d, 'late', 'growth', { wishes: 9 }, now + 31 * 86400).code === 'CLAIM_EXPIRED', '领取资格 30 天过期');
ok(Gate.normRule({ id: 'x', name: 'X', cond: {} }).error && Gate.normRule({ id: 'x y', name: 'X', cond: { wishes: 1 } }).error && Gate.normRule({ id: 'vip', name: 'VIP', cond: { wishes: 2 }, validity: { type: 'days', days: 7 } }).rule.validity.days === 7, '规则校验');
// ---- 4. 到期提醒 ----
console.log('expiry notices');
const dd = { cards: {} }, t0 = 1800000000, mk = (id, exp) => Gate.issue(dd, { id, gateId: 'g', name: id, owner: SOL[0], issuer: 'admin', expireAt: exp }, t0);
mk('far', t0 + 10 * 86400); mk('d3', t0 + 2.5 * 86400); mk('d0', t0 + 3600); mk('past', t0 - 1 + 0); dd.cards.past.expireAt = t0 - 5;
const sw = Gate.sweep(dd, t0).map(x => x.card.id + ':' + x.kind).sort(); ok(JSON.stringify(sw) === JSON.stringify(['d0:gate_expiring0', 'd3:gate_expiring', 'past:gate_expired']), '3 天前 / 当天 / 已过期 提醒: ' + sw.join(','));
ok(Gate.sweep(dd, t0 + 60).length === 0, '同一节点只提醒一次');
ok(Gate.sweep(dd, t0 + 86400 * 2 + 1).map(x => x.card.id + ':' + x.kind).includes('d3:gate_expiring0'), '随后推进到当天再提醒一次');
ok(Gate.view(dd.cards.past, t0).state === 'expired', '已过期保留在记录中（已失效列表）');
// ---- 5. 后端 API 双重校验（临时目录，模拟统计，不上链）----
(async () => {
  console.log('backend API');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-gate-')), port = 18000 + Math.floor(Math.random() * 1000);
  for (const f of fs.readdirSync(__dirname)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(__dirname, f), path.join(tmp, f));
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(tmp, 'node_modules')); fs.symlinkSync(path.join(__dirname, 'public'), path.join(tmp, 'public')); fs.mkdirSync(path.join(tmp, 'data'));
  const srv = cp.spawn(process.execPath, ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', GATE_MOCK_STATS: '1', D1_API_TOKEN: '' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port, call = async (u, tok, body, adm) => { const r = await fetch(B + u, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(adm ? { 'x-admin-key': 'k-test' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try { for (let i = 0; i < 60; i++) { try { await fetch(B + '/api/nonce'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const A = (await call('/api/login', null, { email: 'a@test.dev' })).j, Bu = (await call('/api/login', null, { email: 'b@test.dev' })).j, mock = m => fs.writeFileSync(path.join(tmp, 'data/gate-mock-stats.json'), JSON.stringify(m));
    ok(A.token && Bu.token && A.pubkey !== Bu.pubkey, '两个测试账户登录');
    ok((await call('/api/gate/check?gate=growth')).s === 401 && (await call('/api/treehole')).s === 401, '未登录 → 401 NOT_LOGIN（敏感接口拒绝）');
    mock({ [A.pubkey]: { wishes: 0 } }); let r = await call('/api/treehole', A.token);
    ok(r.s === 403 && r.j.code === 'NO_GATE' && !r.j.posts && r.j.achievements.find(x => x.rule.id === 'growth').progress[0].need === 5, '树洞：无门卡 403 NO_GATE，不返回内容，附带成就进度');
    mock({ [A.pubkey]: { wishes: 3 } }); r = await call('/api/treehole', A.token); ok(r.j.achievements.find(x => x.rule.id === 'growth').progress[0].have === 3, '进度 3/5');
    r = await call('/api/gate/me', A.token); ok(r.j.claimable.map(x => x.ruleId).join() === 'first_light' && r.j.unlocked === false, '/me：3 张心愿 → 仅初心可领取，尚未领取 → 未解锁');
    mock({ [A.pubkey]: { wishes: 5 } }); r = await call('/api/gate/me', A.token); ok(r.j.claimable.map(x => x.ruleId).sort().join() === 'first_light,growth', '/me：达标 → 初心、成长均生成可领取记录');
    let inbox = (await call('/api/inbox', A.token)).j.items; ok(inbox.some(m => m.kind === 'gate_claimable'), '收件箱：门卡可领取通知');
    ok((await call('/api/treehole', A.token)).s === 403, '未领取时仍不可进入（可领取 ≠ 持有）');
    mock({ [A.pubkey]: { wishes: 0 } }); r = await call('/api/gate/claim', A.token, { ruleId: 'growth' }); ok(r.s === 400 && r.j.code === 'NOT_MET', '领取时服务端重新复核条件');
    mock({ [A.pubkey]: { wishes: 5 } }); await call('/api/gate/me', A.token); r = await call('/api/gate/claim', A.token, { ruleId: 'growth' }); ok(r.s === 200 && r.j.card.state === 'valid', '领取成功');
    const cardId = r.j.card.id; inbox = (await call('/api/inbox', A.token)).j.items; ok(inbox.some(m => m.kind === 'gate_received'), '收件箱：收到门卡通知');
    r = await call('/api/treehole', A.token); ok(r.s === 200 && r.j.posts.length === 0 && r.j.cards.length === 1, '持有有效门卡 → 进入树洞（空状态）');
    r = await call('/api/treehole/post', A.token, { text: '今天也要加油 ✨' }); ok(r.s === 200 && r.j.post.mine, '持卡人发布树洞内容');
    const pid = r.j.post.id; r = await call('/api/treehole', Bu.token); ok(r.s === 403 && !JSON.stringify(r.j).includes('加油'), '他人无卡 → 403，响应不含任何树洞内容');
    ok((await call('/api/treehole/post', Bu.token, { text: 'hi' })).s === 403 && (await call('/api/treehole/like', Bu.token, { id: pid })).s === 403 && (await call('/api/treehole/delete', Bu.token, { id: pid })).s === 403, '无卡不可发布 / 点赞 / 删除');
    r = await call('/api/treehole/like', A.token, { id: pid }); ok(r.j.likes === 1 && r.j.liked, '点赞'); r = await call('/api/treehole?sort=hot', A.token); ok(r.j.posts[0].likes === 1 && r.j.posts[0].liked, '最热排序');
    ok((await call('/api/treehole?sort=mine', A.token)).j.posts.length === 1, '仅我可见过滤');
    r = await call('/api/treehole/post', A.token, { text: '加我微信 http://bit.ly/abc' }); ok(r.s === 400, '链接/违规内容被拦截');
    r = await call('/api/gate/check?gate=treehole&card=' + cardId, Bu.token); ok(r.s === 403 || r.j.code === 'NOT_OWNER', '他人地址 + 该卡号 → NOT_OWNER');
    ok((await call('/api/gate/revoke', Bu.token, { id: cardId })).s === 403, '无关用户不能撤销');
    ok((await call('/api/admin/gate/rules', null, null, false)).s === 403 && (await call('/api/admin/gate/issue', A.token, { gateId: 'x' })).s === 403, '管理接口无 ADMIN_KEY → 403');
    r = await call('/api/gate/revoke', null, { id: cardId, reason: '测试撤销' }, true); ok(r.s === 200 && r.j.card.state === 'revoked', '管理员撤销');
    r = await call('/api/treehole', A.token); ok(r.s === 403 && !r.j.posts, '撤销后（另一张卡仍有效时）判定：' + r.s);
    const other = (await call('/api/gate/me', A.token)).j.cards.find(c => c.id !== cardId); if (other) { await call('/api/gate/revoke', null, { id: other.id }, true); r = await call('/api/treehole', A.token); ok(r.s === 403 && r.j.code === 'REVOKED', '全部撤销 → 树洞重新上锁 403 REVOKED'); }
    await call('/api/admin/gate/issue', null, { gateId: 'first_light', addresses: [A.pubkey] }, true); r = await call('/api/treehole', A.token); ok(r.s === 200 || r.s === 403, '管理员手动发放 first_light（按规则默认名称/有效期）');
    ok((await call('/api/inbox', A.token)).j.items.some(m => m.kind === 'gate_revoked'), '收件箱：撤销通知');
    // 批量发放 + 到期
    const t = Math.floor(Date.now() / 1000);
    r = await call('/api/admin/gate/issue', null, { gateId: 'vip', name: 'VIP', benefit: '线上专属', addresses: [Bu.pubkey, Bu.pubkey, 'bad'] }, true); ok(r.s === 400 && r.j.code === 'giftTo', '批量发放：含非法地址整体拒绝');
    r = await call('/api/admin/gate/issue', null, { gateId: 'vip', name: 'VIP', benefit: '线上专属', expireAt: t + 2 * 86400, addresses: [Bu.pubkey, Bu.pubkey] }, true); ok(r.s === 200 && r.j.issued === 1, '批量发放：地址去重，发放 1 张');
    r = await call('/api/gate/me', Bu.token); ok(r.j.cards.length === 1 && r.j.cards[0].state === 'valid', '/me：收到管理员发放的卡');
    inbox = (await call('/api/inbox', Bu.token)).j.items; ok(inbox.some(m => m.kind === 'gate_received') && inbox.some(m => m.kind === 'gate_expiring'), '收件箱：收到 + 3 天内到期提醒');
    r = await call('/api/admin/gate/issue', null, { gateId: 'old', name: 'Old', expireAt: t - 10, addresses: [Bu.pubkey] }, true); ok(r.s === 400 && r.j.code === 'gateExp', '不能发放已过期的卡');
    r = await call('/api/admin/gate/rules', null, { id: 'vip-rule', name: 'VIP 规则', cond: { mode: 'any', wishes: 1, blessings: 1 }, validity: { type: 'days', days: 30 }, enabled: true }, true); ok(r.s === 200 && r.j.rule.enabled, '管理员配置规则');
    ok((await call('/api/gate/rules')).j.rules.some(x => x.id === 'vip-rule') && (await call('/api/notify', Bu.token, { fulfil: true, system: true, gate: false })).j.gate === false, '公开规则列表；消息设置含门卡通知开关');
    // 关闭门卡通知后不再收到
    r = await call('/api/admin/gate/issue', null, { gateId: 'q', name: 'Q', addresses: [Bu.pubkey] }, true); const before = (await call('/api/inbox', Bu.token)).j.items.filter(m => m.name === 'Q'); ok(before.length === 0, '关闭门卡通知后不再投递站内信');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { srv.kill(); }
  console.log(process.exitCode ? '\n❌ failed' : `\n✅ ${n} checks passed`);
})();

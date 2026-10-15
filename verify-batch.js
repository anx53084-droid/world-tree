// 团购礼品卡验证：金额校验、重放、冒领、分片重试、续传、CSV、领取限速、领取绑定。支付核验全部模拟（ADS_MOCK_PAY），不发任何真实链上交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const SOL = 1e9, NOW = 1790000000;
console.log('unit'); const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-batu-')); fs.mkdirSync(path.join(tmpd, 'data'));
for (const f of ['batch.js', 'gate.js']) fs.copyFileSync(path.join(__dirname, f), path.join(tmpd, f)); process.env.BATCH_BACKOFF = '5'; process.env.BATCH_SHARD = '500';
const B = require(path.join(tmpd, 'batch.js')); const mk = (o = {}) => ({ blessing: '愿你被温柔以待', count: 1203, unitSol: 0.0067, gateName: '星光小屋', optPublic: false, optAnchor: false, ...o });
ok(B.validate(mk()).ok.totalLam === 1203 * Math.round(0.0067 * SOL), '总额 = 数量 × 单价（按 lamports 精确计算）');
for (const [o, e, m] of [[{ unitSol: 0.0066 }, 'amount', '低于最低 0.0067 SOL 被拒绝'], [{ unitSol: NaN }, 'amount', '非数字金额被拒绝'], [{ count: 0 }, 'count', '数量 0 被拒绝'], [{ count: 10001 }, 'count', '数量 10001 被拒绝'], [{ count: 1.5 }, 'count', '非整数数量被拒绝'], [{ blessing: '' }, 'blessing', '空祝福被拒绝'], [{ blessing: '字'.repeat(141) }, 'blessing', '祝福超过 140 字被拒绝'], [{ blessing: 'a|b' }, 'blessing', '祝福含 | 被拒绝'], [{ gateName: '  ' }, 'gate', '门卡名称为空被拒绝'], [{ unitSol: 5000 }, 'amount', '单价上限']]) ok(B.validate(mk(o)).error === e, m);
ok(B.validate(mk({ blessing: '字'.repeat(140), count: 10000, unitSol: 0.0067 })).ok.count === 10000 && B.validate(mk({ count: 1 })).ok, '140 字 / 10000 张 / 1 张 边界通过');
ok(B.validate(mk({ gateName: '<b>门~卡|名称</b>很长很长很长很长很长很长很长很长' })).ok.gateName.length <= 20 && !/[<>~|]/.test(B.validate(mk({ gateName: '<b>门~卡|名称</b>' })).ok.gateName), '门卡名称清洗并截断到 20 字');
const v = B.validate(mk()).ok; let r = B.create('OWN', v, { key: 'sigAAAA0001', lamports: v.totalLam }, NOW); const b = r.batch;
ok(r.ok && b.shards.length === 3 && b.shards[2].to === 1203 && b.status === 'queued', '创建批次：1203 张按 500 分片 → 3 片');
console.log('replay / idempotency'); r = B.create('OWN', v, { key: 'sigAAAA0001', lamports: v.totalLam }, NOW + 1); ok(r.ok && r.dup && r.batch.id === b.id && Object.keys(B.load().batches).length === 1, '同一支付重复提交：返回同一批次，不重复创建');
ok(B.create('EVIL', v, { key: 'sigAAAA0001', lamports: v.totalLam }, NOW).error === 'used', '他人拿同一支付签名创建批次 → used（防重放 / 冒用）');
ok(B.create('OWN', v, { key: 'sigBBBB0002', lamports: v.totalLam - 1 }, NOW).error === 'amount', '到账金额不足（少 1 lamport）→ amount');
console.log('shards / retry / resume'); const fails = {}; B.hooks.shard = (bt, sh) => { if (sh.i === 1 && (fails.x = (fails.x || 0) + 1) <= 2) throw new Error('boom'); };
let t0 = NOW + 10; ok(B.tick(t0, 10) === 3 && b.shards[0].state === 'done' && b.shards[1].state === 'queued' && b.shards[1].tries === 1 && b.shards[1].nextAt === t0 + 5 && b.shards[2].state === 'done', '分片 1 失败：其它分片继续；第 1 次重试退避 5 秒');
ok(B.tick(t0 + 4, 10) === 0, '退避期内不重试'); ok(B.tick(t0 + 5, 10) === 1 && b.shards[1].tries === 2 && b.shards[1].nextAt === t0 + 5 + 10, '第 2 次失败：退避翻倍（10 秒）');
const snapshot = B.view(b, t0 + 6); ok(snapshot.issued === 703 && snapshot.shards.done === 2 && snapshot.percent === 58 && snapshot.status === 'running' && snapshot.nextRetryAt === t0 + 15, '进度：已生成 703/1203，下次重试时间可见');
// 模拟进程中断：把分片 1 置为 running（启动时间很早），写盘后重新加载
b.shards[1].state = 'running'; b.shards[1].startedAt = 1; B.flush(); const codesBefore = Object.keys(B.load().codes).length; B.reset(); const b2 = B.load().batches[b.id];
ok(b2.shards[1].state === 'running' && Object.keys(B.load().codes).length === codesBefore, '重启后状态来自磁盘（断点续传）：已完成分片保留');
ok(B.tick(t0 + 20, 10) === 1 && b2.shards[1].state === 'done' && b2.status === 'done' && B.view(b2).issued === 1203 && Object.keys(B.load().codes).length === 1203, '续传：超时的 running 分片重新排队并完成，共 1203 个唯一码');
const c0 = B.codeFor(b.id, 0); B.hooks.shard = null; const again = Object.keys(B.load().codes).length; ok(B.codeFor(b.id, 0) === c0 && /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/.test(c0) && again === 1203, '领取码确定性：重算相同（重试幂等）；格式 5-5-5-5，100 bit');
const set = new Set(); for (let i = 0; i < 10000; i++) set.add(B.codeFor('b_perf', i)); ok(set.size === 10000, '10000 个码互不重复');
B.hooks.shard = () => { throw new Error('always'); }; r = B.create('OWN', B.validate(mk({ count: 10 })).ok, { key: 'sigCCCC0003', lamports: 1e12 }, NOW); const bf = r.batch; let tt = NOW + 100; for (let i = 0; i < 8; i++) { B.tick(tt, 10); tt += 1000; }
ok(bf.status === 'failed' && bf.shards[0].state === 'failed' && bf.shards[0].tries === 6 && B.load().alerts.some(a => a.batch === bf.id) && !JSON.stringify(B.load().alerts).includes(B.load().meta.secret), '重试 6 次仍失败：批次 failed + 告警日志（不含密钥）');
B.hooks.shard = null; ok(B.retryFailed(bf.id) === 1 && B.tick(tt, 10) === 1 && bf.status === 'done', '管理员重新排队失败分片后完成');
console.log('csv'); const csv = B.csv(b2, 'https://x.example'), lines = csv.split('\r\n').filter(Boolean); ok(csv.charCodeAt(0) === 0xFEFF && lines[0] === '\ufeff序号,领取码,领取链接,状态' && lines.length === 1204, 'CSV：UTF-8 BOM + 表头（序号,领取码,领取链接,状态）+ 1203 行');
ok(lines[1] === `"1","${B.codeFor(b.id, 0)}","https://x.example/#/claim/${B.codeFor(b.id, 0)}","未领取"` && !/"已领取"/.test(csv), 'CSV 行内容：序号 / 码 / 领取链接 / 未领取');
console.log('claim'); const code = B.codeFor(b.id, 7); ok(B.peek(code).state === 'new' && B.peek(code.toLowerCase().replace(/-/g, ' ')).ok, '预览不改变状态；码大小写 / 分隔符宽容');
let cl = B.claim(code, 'U1', NOW + 50); ok(cl.ok && cl.card.owner === 'U1' && cl.card.name === '星光小屋' && cl.card.gateId === 'b_' + b.id && cl.card.expireAt === 0, '领取：绑定领取者，签发门卡（名称 = 专属空间标题，永久）');
const G = require(path.join(tmpd, 'gate.js')); ok(Object.values(G.load().cards).some(c => c.owner === 'U1' && c.source === 'batch' && c.issuer === 'OWN'), '门卡写入 gate 存储（source=batch，issuer=批次所有者）');
ok(B.claim(code, 'U1', NOW + 60).dup === true && Object.values(G.load().cards).filter(c => c.owner === 'U1').length === 1, '本人重复领取：幂等，不重复发卡'); ok(B.claim(code, 'U2', NOW + 60).error === 'used', '一码一领：他人再领 → used');
ok(B.claim('AAAAA-AAAAA-AAAAA-AAAAA', 'U2', NOW).error === 'nf' && B.claim('short', 'U2', NOW).error === 'nf' && B.claim(code, '', NOW).error === 'nf', '无效码 / 无账户 → nf'); ok(B.csv(b2, 'https://x.example').includes('"8","' + code) && B.csv(b2, 'https://x.example').match(/"已领取"/g).length === 1, 'CSV 状态随领取更新（已领取 1）'); ok(B.view(b2).claimed === 1, '进度含已领取数');
let lim = 0; for (let i = 0; i < 25; i++) if (B.limited('claim|1.2.3.4', 20, 600000, 1000 + i)) lim++; ok(lim === 5 && !B.limited('claim|5.6.7.8', 20, 600000, 1000), '限速：同一 IP 10 分钟内超过 20 次被限（另一个 IP 不受影响）');
console.log('anchor'); const am = B.anchorMemo(b2); ok(/^WTREE1\|BG\|b_[0-9a-f]{16}\|1203\|[0-9a-f]{32}$/.test(am) && Buffer.byteLength(am) < 120 && B.anchorMemo(b2) === am, '门内记录 memo：批次号 + 数量 + Merkle 根（确定性，< 120 字节）');
ok(B.setAnchor(b.id, 'sigANCH0001').ok && B.setAnchor(b.id, 'sigANCH0001').dup && B.setAnchor(b.id, 'sigOTHER0002').error === 'exists', '锚定记录幂等；不能被另一笔覆盖');
// ---------- 集成（真实服务进程 + 模拟支付）----------
(async () => {
  console.log('backend'); const D = __dirname, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-batsrv-')), port = 18921, Bs = 'http://127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', ADS_MOCK_PAY: '1', BATCH_SHARD: '500' }, stdio: 'ignore' });
  const wr = (f, o) => fs.writeFileSync(path.join(tmp, 'data', f), JSON.stringify(o)), rd = f => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8')); } catch { return {}; } };
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); const ab = Buffer.from(await x.arrayBuffer()), tx = ab.toString('utf8'), bom = ab[0] === 0xEF && ab[1] === 0xBB && ab[2] === 0xBF; let j = {}; try { j = JSON.parse(tx); } catch {} return { s: x.status, j, text: tx, bom, h: x.headers }; };
  try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/nonce'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const M = (await call('/api/login', { email: 'merchant@test.dev' })).j, O = (await call('/api/login', { email: 'other@test.dev' })).j, tk = u => ({ authorization: 'Bearer ' + u.token }), adm = { 'x-admin-key': 'k-test' };
    const per = Math.round(0.0067 * SOL), body = (o = {}) => ({ blessing: '愿你被温柔以待', count: 1203, unitSol: 0.0067, gateName: '星光小屋', optPublic: false, optAnchor: false, ...o });
    let x = await call('/api/batch/cfg'); ok(x.s === 200 && x.j.minSol === 0.0067 && x.j.maxCount === 10000 && x.j.shard === 500 && x.j.receive, '配置接口：最低 0.0067、最多 10000、分片 500、收款地址');
    ok((await call('/api/batch/create', body({ sig: 'MOCKnologin01' }))).s === 401, '未登录创建 → 401');
    ok((await call('/api/batch/create', body({ unitSol: 0.001, sig: 'MOCKlow00001' }), tk(M))).j.code === 'amount' && (await call('/api/batch/create', body({ count: 20000, sig: 'MOCKlow00002' }), tk(M))).j.code === 'count', '金额 / 数量校验（服务端）');
    ok((await call('/api/batch/create', body({ sig: 'MOCKnotpaid001' }), tk(M))).j.code === 'verify', '链上查不到的支付签名 → verify');
    const total = per * 1203; wr('ads-mock-pay.json', { MOCKpaidM00001: { signer: M.pubkey, lamports: total }, MOCKshort00001: { signer: M.pubkey, lamports: total - 5 }, MOCKpaidO00001: { signer: O.pubkey, lamports: total } });
    ok((await call('/api/batch/create', body({ sig: 'MOCKshort00001' }), tk(M))).j.code === 'amount', '到账金额不足 → amount（服务端以链上到账为准，不信任客户端金额）');
    ok((await call('/api/batch/create', body({ sig: 'MOCKpaidM00001' }), tk(O))).j.code === 'verify', '他人签名冒用：O 拿 M 的支付签名 → verify（签名者必须是当前登录账户）');
    x = await call('/api/batch/create', body({ sig: 'MOCKpaidM00001' }), tk(M)); const id = x.j.batch && x.j.batch.id; ok(x.s === 200 && /^b_[0-9a-f]{16}$/.test(id) && x.j.batch.count === 1203 && x.j.batch.totalSol === total / SOL, '支付核验通过 → 创建批次任务');
    x = await call('/api/batch/create', body({ sig: 'MOCKpaidM00001' }), tk(M)); ok(x.s === 200 && x.j.dup && x.j.batch.id === id, '重放同一支付 → 返回同一批次（幂等）');
    ok((await call('/api/batch/create', body({ sig: 'MOCKpaidM00001' }), tk(O))).s === 409 || (await call('/api/batch/create', body({ sig: 'MOCKpaidM00001' }), tk(O))).j.code === 'verify', '他人重放同一签名 → 拒绝');
    let st; for (let i = 0; i < 30; i++) { st = (await call('/api/batch/' + id, null, tk(M))).j.batch; if (st.status === 'done') break; await new Promise(r => setTimeout(r, 500)); } ok(st.status === 'done' && st.issued === 1203 && st.percent === 100 && st.shards.total === 3, '队列自动处理：3 个分片完成，进度 100%');
    ok((await call('/api/batch/' + id, null, tk(O))).s === 403 && (await call('/api/batch/' + id)).s === 401 && (await call('/api/batch/' + id + '/csv', null, tk(O))).s === 403, '进度 / CSV 只有批次所有者可读（其他人 403，未登录 401）');
    ok((await call('/api/batch/mine', null, tk(M))).j.batches[0].id === id && (await call('/api/batch/mine', null, tk(O))).j.batches.length === 0, '“我的批次”按钱包身份隔离（换设备同账户可续看）');
    const cs = await call('/api/batch/' + id + '/csv', null, tk(M)); const rows = cs.text.replace(/^\ufeff/, '').split('\r\n').filter(Boolean); ok(cs.s === 200 && /text\/csv/.test(cs.h.get('content-type')) && cs.bom && rows.length === 1204 && rows[0].includes('序号,领取码,领取链接,状态'), 'CSV 下载：UTF-8 BOM，1203 行');
    const codes = rows.slice(1).map(l => l.split('","')[1]); ok(new Set(codes).size === 1203 && (await call('/api/batch/' + id + '/csv', null, tk(M))).text === cs.text, '1203 个码唯一；重复导出内容一致');
    const pk = await call('/api/batch/peek?code=' + codes[0]); ok(pk.s === 200 && pk.j.gateName === '星光小屋' && pk.j.state === 'new' && !('by' in pk.j) && !JSON.stringify(pk.j).includes(M.pubkey), '领取页预览：只含祝福 / 门卡名 / 状态，不泄露所有者');
    ok((await call('/api/batch/claim', { code: codes[0] })).s === 401, '领取需要登录（钱包身份绑定）');
    x = await call('/api/batch/claim', { code: codes[0] }, tk(O)); ok(x.s === 200 && x.j.card.owner === O.pubkey && x.j.card.name === '星光小屋', '领取：绑定到登录钱包，签发门卡');
    ok((await call('/api/batch/claim', { code: codes[0] }, tk(M))).j.code === 'used' && (await call('/api/batch/claim', { code: codes[0] }, tk(O))).j.dup === true, '一码一领：他人 used；本人重复幂等');
    const gm = await call('/api/gate/me', null, tk(O)); ok(gm.s === 200 && JSON.stringify(gm.j).includes('星光小屋'), '门卡出现在领取者的“我的门卡”里（对接 gate 体系）');
    ok((await call('/api/batch/' + id, null, tk(M))).j.batch.claimed === 1, '进度中的已领取数 = 1');
    let last = 0; for (let i = 0; i < 25; i++) last = (await call('/api/batch/claim', { code: 'AAAAA-AAAAA-AAAAA-A' + String(i).padStart(4, '0') }, tk(M))).s; ok(last === 429, '领取限速：连续猜码 20 次后 429（防暴力枚举）');
    ok((await call('/api/batch/peek?code=x')).s === 404 || (await call('/api/batch/peek?code=x')).s === 429, '无效码预览：404（且同样受限速）');
    // 审核：过滤关键词 / 链接
    wr('ads-mock-pay.json', { ...rd('ads-mock-pay.json'), MOCKbad0000001: { signer: M.pubkey, lamports: per * 5 } }); x = await call('/api/batch/create', body({ count: 5, blessing: '快来 https://bit.ly/abc 领取', sig: 'MOCKbad0000001' }), tk(M)); ok(x.j.code === 'blocked', '自动过滤：短链 / 黑名单链接被拒绝（沿用 blocklist，无人工审核）');
    ok((await call('/api/batch/create', body({ count: 5, evm: { chainId: 11155111, txs: ['0x' + '1'.repeat(64)] }, optPublic: true }), tk(M))).j.code === 'evmOpt', 'EVM 账户不支持“公开 / 上链”选项（明确拒绝，不假装）');
    // 托管账户一次支付（模拟）
    x = await call('/api/batch/create', body({ count: 10, pay: true }), tk(M)); ok(x.s === 200 && x.j.batch.count === 10 && /^MOCK/.test(Object.keys(rd('ads-mock-pay.json')).pop()), '托管账户：服务端代签一笔总额支付（模拟）后创建批次');
    // 管理 / 运维
    ok((await call('/api/admin/batch')).s === 403, '管理接口无密钥 → 403'); const as = await call('/api/admin/batch', null, adm); ok(as.s === 200 && as.j.batches >= 2 && as.j.byStatus.done >= 1 && Array.isArray(as.j.alerts) && !JSON.stringify(as.j).includes('"secret"') && !as.text.includes(codes[1]), '管理：任务状态汇总 + 告警日志；不含密钥 / 领取码');
    ok((await call('/api/admin/batch/retry', { id }, adm)).j.requeued === 0, '管理：重新排队失败分片（无失败分片 → 0）');
    // 门内记录上链（可选，用户自付 gas）：模拟
    wr('ads-mock-pay.json', { ...rd('ads-mock-pay.json'), MOCKanchorpay01: { signer: M.pubkey, lamports: per * 3 } }); x = await call('/api/batch/create', body({ count: 3, optAnchor: true, sig: 'MOCKanchorpay01' }), tk(M)); const aid = x.j.batch.id;
    ok((await call('/api/batch/anchor', { id: aid, sig: 'MOCKanchorsig01' }, tk(M))).j.code === 'state', '批次未完成时不能锚定');
    for (let i = 0; i < 20; i++) { st = (await call('/api/batch/' + aid, null, tk(M))).j.batch; if (st.status === 'done') break; await new Promise(r => setTimeout(r, 400)); } ok(st.status === 'done' && /^WTREE1\|BG\|/.test(st.anchorMemo) && !st.anchor, '完成后给出待签 memo（用户自付 gas），尚未写链时 anchor 为空');
    ok((await call('/api/batch/anchor', { id: aid, sig: 'MOCKanchorsig01' }, tk(M))).j.code === 'verify', '没有对应链上记录 → 不会假装已上链');
    wr('batch-mock-anchor.json', { MOCKanchorsig01: { signer: M.pubkey, memo: st.anchorMemo }, MOCKanchorbad01: { signer: M.pubkey, memo: 'WTREE1|BG|x' }, MOCKanchoroth01: { signer: O.pubkey, memo: st.anchorMemo } });
    ok((await call('/api/batch/anchor', { id: aid, sig: 'MOCKanchorbad01' }, tk(M))).j.code === 'verify' && (await call('/api/batch/anchor', { id: aid, sig: 'MOCKanchoroth01' }, tk(M))).j.code === 'verify' && (await call('/api/batch/anchor', { id: aid, sig: 'MOCKanchorsig01' }, tk(O))).s === 403, '锚定核验：memo 不符 / 签名者不是所有者 / 非所有者 → 拒绝');
    x = await call('/api/batch/anchor', { id: aid, sig: 'MOCKanchorsig01' }, tk(M)); ok(x.s === 200 && x.j.batch.anchor.sig === 'MOCKanchorsig01', '锚定成功后进度里出现链上记录签名');
    ok(/batches\.json/.test(fs.readFileSync(path.join(__dirname, 'persist.js'), 'utf8')) && fs.existsSync(path.join(tmp, 'data', 'batches.json')), '批次数据落盘 data/batches.json 并纳入 persist.js（D1 write-through）');
    const raw = fs.readFileSync(path.join(tmp, 'data', 'batches.json'), 'utf8'); ok(!raw.includes(codes[0]) && !raw.includes(codes[5]), '库里不存明文领取码（只存哈希索引；码由密钥确定性派生）');
  } finally { srv.kill(); }
  console.log(`\n✅ ${n} checks passed`); process.exit(0);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });

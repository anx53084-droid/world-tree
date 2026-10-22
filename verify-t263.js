// t263：全自动审核——举报自动复审、防滥用（同 IP/设备/同时段注册聚类、低信用、禁报、日上限、新号集中举报冻结）、干净卡保护与冷却、一键申诉自动恢复、AI 故障回退。
// 本地起服务 + 本地模拟 OpenAI moderation（OPENAI_MOD_URL）：文本含 AIBAD 判违规（可开关）。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http'), assert = require('assert'), nacl = require('tweetnacl'), b58 = require('bs58').default || require('bs58'), crypto = require('crypto');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, sha = s => crypto.createHash('sha256').update(String(s)).digest('hex'), wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let strict = true, aiCalls = 0; const mock = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { aiCalls++; const j = JSON.parse(b || '{}'), txt = (j.input || []).map(x => x.text || '').join(' '), bad = strict && /AIBAD/.test(txt);
    s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ results: [{ flagged: bad, categories: { violence: bad }, category_scores: { violence: bad ? .95 : .01 } }] })); }); }).listen(18771);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-263-')), port = 18997, Bs = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f));
  fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const now = Date.now(), fc = (id, text, tok) => ({ id, text, cat: '经典', cover: 0, at: now - 5000, tok: sha(tok || 'x' + id), ip: 'seed' });
  const free = { a00000000001: fc('a00000000001', '希望大家都健康快乐'), a00000000002: fc('a00000000002', 'AIBAD 威胁内容示例'), a00000000003: fc('a00000000003', '愿春天早点来'), a00000000004: fc('a00000000004', '愿世界和平'),
    a00000000005: fc('a00000000005', 'AIBAD 低信用测试'), a00000000006: fc('a00000000006', 'AIBAD 可申诉测试', 'tok6'), a00000000007: fc('a00000000007', '愿考试顺利') };
  fs.writeFileSync(tmp + '/data/social.json', JSON.stringify({ free, mod: { OF_a00000000004: { state: 'clean', strong: true, at: now - 1000 } } }));
  const env = { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', PRICE_MOCK: '1', OPENAI_API_KEY: 'test-key', OPENAI_MOD_URL: 'http://127.0.0.1:18771/v1/moderations', MOD_AWAIT: '1', NETWORK: 'testnet' };
  let srv; const start = async () => { srv = cp.spawn('node', ['server.js'], { cwd: tmp, env, stdio: 'ignore' }); for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); return; } catch { await wait(250); } } };
  const call = async (p, body, h = {}) => { const x = await fetch(Bs + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await x.json(); } catch {} return { s: x.status, j }; };
  try {
    await start();
    const wlogin = async () => { const kp = nacl.sign.keyPair(), a = b58.encode(kp.publicKey), nonce = (await call('/api/nonce')).j.nonce;
      const m = `${host} wants you to sign in with your Solana account:\n${a}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const r = (await call('/api/login/wallet', { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) })).j; assert(r.token); return { token: r.token, pubkey: a, uid: 'sol:' + a }; };
    const U = {}; for (const k of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'N1', 'N2', 'N3', 'N4']) U[k] = await wlogin();
    // 调整注册时间：老号相隔数小时；N1–N4 为刚注册的新号（同一时段）
    srv.kill(); await wait(800); const db = JSON.parse(fs.readFileSync(tmp + '/data/users.json'));
    Object.entries(U).forEach(([k, u], i) => { const id = Object.keys(db.users).find(x => db.users[x].pubkey === u.pubkey); u.uid = id; db.users[id].created = k[0] === 'V' ? now - 30 * 864e5 - i * 5 * 3600e3 : now - 60e3 * (i - 6); });
    fs.writeFileSync(tmp + '/data/users.json', JSON.stringify(db)); await start();
    const H = (u, ip, dev) => ({ authorization: 'Bearer ' + u.token, 'cf-connecting-ip': ip, 'x-wt-dev': dev }), rep = (u, sig, ip, dev, reason = 'abuse') => call('/api/report', { sig, reason }, H(u, ip, dev));
    const hidden = async () => (await call('/api/offchain')).j.hidden || [], adm = async () => (await call('/api/admin/moderation', null, { 'x-admin-key': 'k-test' })).j;
    ok((await call('/api/report', { sig: 'OF_a00000000002', reason: 'abuse' })).s === 401, '匿名举报被拒（须钱包/账号）');
    // 1) 举报 → AI 复审 → 违规自动隐藏
    let r = await rep(U.V1, 'OF_a00000000002', '10.0.0.1', 'd1'); ok(r.j.queued, '可信举报触发自动复审');
    ok((await hidden()).includes('OF_a00000000002'), 'AI 判定违规 → 自动隐藏');
    // 2) 干净卡：举报被驳回、不隐藏、信用扣分、同理由 7 天冷却
    r = await rep(U.V2, 'OF_a00000000001', '10.0.0.2', 'd2'); ok(r.j.queued && !(await hidden()).includes('OF_a00000000001'), '干净卡复审通过 → 不隐藏（举报数不是隐藏理由）');
    let A = await adm(); ok(A.credit[U.V1.uid].c === 55 && A.credit[U.V2.uid].c === 40, `信用分：采纳 +5（${A.credit[U.V1.uid].c}），驳回 −10（${A.credit[U.V2.uid].c}）`);
    r = await rep(U.V3, 'OF_a00000000001', '10.0.0.3', 'd3'); ok(!r.j.queued && Object.values((await adm()).reports).some(x => x.uid === U.V3.uid && x.status === 'dropped-cooldown'), '判定干净后同理由 7 天内不再触发');
    // 3) 已过 AI 的卡（受保护）：单个可信举报不触发复审
    r = await rep(U.V4, 'OF_a00000000004', '10.0.0.4', 'd4'); ok(!r.j.queued, '已过 AI 的卡需更高权重（单个举报不触发）');
    // 4) 同 IP / 同设备聚类只计一次
    r = await rep(U.V5, 'OF_a00000000004', '10.0.0.4', 'd5'); A = await adm(); ok(A.reports.find(x => x.uid === U.V5.uid).status === 'dropped-dup', '同 IP 账号对同卡只计一次');
    r = await rep(U.V6, 'OF_a00000000004', '10.0.0.6', 'd4'); A = await adm(); ok(A.reports.find(x => x.uid === U.V6.uid).status === 'dropped-dup', '同设备账号对同卡只计一次');
    // 5) Sybil：同时段注册的新号集中举报 → 聚类去重 + 冻结 + 管理员通知，卡片不受影响
    for (const [i, k] of ['N1', 'N2', 'N3', 'N4'].entries()) await rep(U[k], 'OF_a00000000003', '10.9.0.' + (i + 1), 'dn' + i);
    A = await adm(); const nr = A.reports.filter(x => x.sig === 'OF_a00000000003');
    ok(nr.every(x => x.status === 'frozen' || /^dropped/.test(x.status)) && nr.some(x => x.status === 'frozen'), `新号集中举报被冻结（${nr.map(x => x.status).join(',')}）`);
    ok(A.notices.some(x => x.kind === 'reportBurst' && x.sig === 'OF_a00000000003'), '管理员收到攻击通知');
    ok(!(await hidden()).includes('OF_a00000000003'), 'Sybil 攻击不影响卡片');
    // 6) 低信用举报被忽略；屡犯禁止举报
    await call('/api/admin/moderation/credit', { uid: U.V7.uid, c: 10 }, { 'x-admin-key': 'k-test' });
    r = await rep(U.V7, 'OF_a00000000005', '10.0.0.7', 'd7'); ok(!r.j.queued && !(await hidden()).includes('OF_a00000000005'), '低信用举报被忽略（违规卡也不会因其触发）');
    await call('/api/admin/moderation/credit', { uid: U.V7.uid, ban: true }, { 'x-admin-key': 'k-test' });
    r = await rep(U.V7, 'OF_a00000000007', '10.0.0.7', 'd7'); ok(r.s === 403 && r.j.code === 'repBanned', '屡犯仅被禁止举报');
    // 7) 每日上限
    for (let i = 0; i < 4; i++) await rep(U.V1, 'OF_b0000000000' + i, '10.0.0.1', 'd1');
    r = await rep(U.V1, 'OF_a00000000007', '10.0.0.1', 'd1'); ok(r.s === 429 && r.j.code === 'repCap', '每账号每日举报上限');
    // 8) 一键申诉：AI 复审通过 → 自动恢复 + 举报人扣信用；每卡一次
    r = await rep(U.V3, 'OF_a00000000006', '10.0.0.3', 'd3'); ok((await hidden()).includes('OF_a00000000006'), '申诉前：卡片被自动隐藏');
    const modh = (await call('/api/offchain')).j.modh; ok(modh.OF_a00000000006 && modh.OF_a00000000006.ap === false, 'offchain 返回隐藏卡申诉状态');
    ok((await call('/api/appeal', { sig: 'OF_a00000000006', token: 'wrong' })).s === 403, '非作者不能申诉');
    strict = false; r = await call('/api/appeal', { sig: 'OF_a00000000006', token: 'tok6' }); ok(r.j.restored && !(await hidden()).includes('OF_a00000000006'), '申诉 → 自动复审通过 → 自动恢复');
    A = await adm(); ok(A.credit[U.V3.uid].c === 35 && A.reports.find(x => x.sig === 'OF_a00000000006').status === 'overturned', `申诉成功后举报人信用被扣（${A.credit[U.V3.uid].c}）`);
    ok(A.mod.OF_a00000000006.appealed > 0, '申诉次数已记录（每卡一次）');
    strict = true; const st = JSON.parse(fs.readFileSync(tmp + '/data/social.json')); ok(!fs.existsSync(tmp + '/data/review-queue.jsonl'), '不再写无人读取的人工复核队列');
    // 9) AI 故障回退：不阻塞用户
    mock.close(); await wait(200); const m = await call('/api/moderate', { text: '希望明天是晴天', prefix: '经典' }); ok(m.j.pass === true, 'AI 服务不可用时回退关键词+NSFW，不阻塞正常内容');
    ok((await call('/api/moderate', { text: '我要买毒品', prefix: '经典' })).j.pass === false, '关键词仍生效');
    ok((await call('/api/mod/status')).j.ai === true, '/api/mod/status 显示 AI 已配置');
    console.log(`t263 OK ${n} checks (mock AI calls ${aiCalls})`);
  } finally { srv?.kill(); mock.close(); }
})().catch(e => { console.error('✗', e.message); process.exit(1); });

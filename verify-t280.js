// t280 站长钱包树洞权限：临时目录 + 临时生成的钱包作为 HOLLOW_OWNERS（不使用真实站长私钥）；验证签名登录才生效、普通用户无变化
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), nacl = require('tweetnacl'), bs58 = require('bs58'), b58 = bs58.default || bs58;
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const H = require('./hollow'); ok(H.OWNERS.has('2Xjes9L3kePHUKyQaFfueHr933d6V71rPSSF3zZxL6pc'), '默认白名单包含站长钱包 2Xje…6pc');
ok(!H.isOwner({ uid: 'a@x.dev', user: { pubkey: '2Xjes9L3kePHUKyQaFfueHr933d6V71rPSSF3zZxL6pc' } }), '仅地址字符串（非钱包签名会话）不算站长');
(async () => {
  const kp = nacl.sign.keyPair(), owner = b58.encode(kp.publicKey), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-280-')), port = 19900 + Math.floor(Math.random() * 90), B = 'http://127.0.0.1:' + port, host = '127.0.0.1:' + port;
  for (const f of fs.readdirSync(__dirname)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(__dirname, f), path.join(tmp, f));
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(tmp, 'node_modules')); fs.symlinkSync(path.join(__dirname, 'public'), path.join(tmp, 'public')); fs.mkdirSync(path.join(tmp, 'data'));
  const srv = cp.spawn(process.execPath, ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, HOLLOW_OWNERS: owner, GATE_MOCK_STATS: '1', D1_API_TOKEN: '' }, stdio: 'ignore' });
  const call = async (u, o = {}) => { const r = await fetch(B + u, { method: o.body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'cf-connecting-ip': o.ip || '10.0.0.1', ...(o.tok ? { authorization: 'Bearer ' + o.tok } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j }; };
  const cap = async ip => { const c = (await call('/api/free/challenge', { ip })).j, [a, b] = c.q.match(/\d+/g).map(Number); return { cid: c.cid, ans: a + b }; };
  try { for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/nonce'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const nonce = (await call('/api/nonce')).j.nonce, m = `${host} wants you to sign in with your Solana account:\n${owner}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    const O = (await call('/api/login/wallet', { body: { message: m, signature: b58.encode(nacl.sign.detached(Buffer.from(m), kp.secretKey)) } })).j; ok(!!O.token, '站长钱包签名登录');
    const nonce2 = (await call('/api/nonce')).j.nonce, m2 = m.replace(/Nonce: .*/, 'Nonce: ' + nonce2), bad = await call('/api/login/wallet', { body: { message: m2, signature: b58.encode(nacl.sign.detached(Buffer.from(m2), nacl.sign.keyPair().secretKey)) } }); ok(bad.s === 401, '只有地址、没有正确签名 → 登录失败');
    let r = await call('/api/hollow/state', { tok: O.token }); ok(r.j.owner === true && r.j.open.length === 10 && r.j.cards.length === 10, '站长：10 扇门全开、10 张门卡显示为已拥有');
    ok((await call('/api/hollow/msgs?door=phoenix', { tok: O.token })).s === 200, '站长可读 Coming soon 门内');
    for (let i = 0; i < 3; i++) { r = await call('/api/hollow/msg', { tok: O.token, ip: '10.2.2.2', body: { door: 'phoenix', text: 'owner preview note ' + i, ...(await cap('10.2.2.2')) } }); ok(r.s === 200 && r.j.item.door === 'phoenix', '站长留言 #' + (i + 1) + ' 不受免费额度限制'); }
    const U = (await call('/api/login', { body: { email: 'u@test.dev' } })).j;
    r = await call('/api/hollow/state', { tok: U.token }); ok(!r.j.owner && r.j.open.join() === 'first,sea' && !r.j.cards.length, '普通用户：无变化');
    r = await call('/api/hollow/state'); ok(!r.j.owner && r.j.open.join() === 'first,sea', '未登录：无变化');
    ok((await call('/api/hollow/msgs?door=phoenix', { tok: U.token })).j.items.length === 0, '普通用户看不到 Coming soon 门内留言');
    ok((await call('/api/hollow/claim', { tok: U.token, body: { card: 'phoenix' } })).s === 400, '普通用户不能领 Coming soon 门卡');
    r = await call('/api/hollow/msg', { tok: U.token, ip: '10.3.3.3', body: { door: 'phoenix', text: 'hello', ...(await cap('10.3.3.3')) } }); ok(r.s === 200 && r.j.item.door === 'first', '普通用户写到未开放门 → 回落到 First Light');
    r = await call('/api/hollow/msg', { tok: U.token, ip: '10.3.3.4', body: { text: 'again', ...(await cap('10.3.3.4')) } }); ok(r.j.code === 'hUsed', '普通用户仍是终身 1 条');
  } catch (e) { ok(false, 'exception ' + e.stack); } finally { srv.kill(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL OK'); process.exit(fail ? 1 : 0);
})();

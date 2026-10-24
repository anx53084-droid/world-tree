// t309：非托管 EVM 登录 + EVM 心愿（用户自签 + 自付，服务器只核验）。本地主网冒烟：PRICE_MOCK、EVM RPC 指向本地模拟节点，不连接任何真实链、不发任何真实交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http'), assert = require('assert'), crypto = require('crypto');
const { secp256k1 } = require('@noble/curves/secp256k1'), { keccak_256 } = require('@noble/hashes/sha3');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); }; const D = __dirname;
const SAFE_L2 = '0x71c04f3C4922d1A6FA2724428d4E2c51f5445837', SAFE_ETH = '0xbfa2C12D28838bEA6C92645c195fAa907182ECed';
const PK = keccak_256(new TextEncoder().encode('wt-t309-evm')), EA = '0x' + Buffer.from(keccak_256(secp256k1.getPublicKey(PK, false).slice(1)).slice(-20)).toString('hex');
const sign = msg => { const mb = Buffer.from(msg), h = keccak_256(Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n' + mb.length), mb])), s = secp256k1.sign(h, PK); return '0x' + s.toCompactHex() + (27 + s.recovery).toString(16); };
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const wishMsg = (a, c, h, at) => `Guangqi World Tree wish\nAddress: ${a.toLowerCase()}\nChain ID: ${c}\nWish SHA-256: ${h}\nIssued At: ${at}\n\nSigning is free and does not move funds.`;
// ---- 模拟 EVM 节点（Base / Ethereum 共用）----
const TX = {}, HEAD = { v: 1000 }; const wei = eth => '0x' + BigInt(Math.round(eth * 1e9) * 1e9).toString(16);
const addTx = (h, o) => { TX[h] = { hash: h, from: o.from || EA, to: o.to || SAFE_L2, value: wei(o.eth), chainId: o.chainId, blockNumber: '0x' + (o.block || 990).toString(16), status: o.status || '0x1' }; return h; };
const H = i => '0x' + String(i).padStart(64, '0');
const rpcSrv = http.createServer((q, s) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { const j = JSON.parse(b), p = j.params || []; let r = null;
  if (j.method === 'eth_getTransactionByHash') { const t = TX[p[0]]; r = t && { hash: t.hash, from: t.from, to: t.to, value: t.value, chainId: t.chainId, blockNumber: t.blockNumber }; }
  else if (j.method === 'eth_getTransactionReceipt') { const t = TX[p[0]]; r = t && { status: t.status, blockNumber: t.blockNumber }; }
  else if (j.method === 'eth_blockNumber') r = '0x' + HEAD.v.toString(16);
  else if (j.method === 'eth_getBlockByNumber') r = { timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) };
  else if (j.method === 'eth_gasPrice') r = '0x' + (5e7).toString(16); // 0.05 gwei
  else if (j.method === 'eth_estimateGas') r = '0x5208';
  else if (j.method === 'eth_call') r = '0x' + (2e10).toString(16).padStart(64, '0');
  s.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); s.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: r })); }); });
(async () => {
  await new Promise(r => rpcSrv.listen(18960, r)); const MOCK = 'http://127.0.0.1:18960';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-t309-')), port = 18961, Bs = 'http://127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  const setPrice = stale => fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600, stale })); setPrice(false);
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, NETWORK: 'mainnet', SOLANA_RPC_MAINNET: '', ADMIN_KEY: 'k', D1_API_TOKEN: '', PRICE_MOCK: '1', EVM_RPC_8453: MOCK, EVM_RPC_1: MOCK, EVM_RPC_42161: MOCK, EVM_RPC_56: MOCK, OPENAI_API_KEY: '' }, stdio: 'ignore' });
  const call = async (p, b, h = {}) => { const r = await fetch(Bs + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j }; };
  let br; try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    console.log('server: non-custodial EVM login');
    const host = '127.0.0.1:' + port, nonce = (await call('/api/nonce')).j.nonce;
    const m = `${host} wants you to sign in with your Ethereum account:\n${EA}\n\nSign in to World Tree.\n\nURI: http://${host}\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    let x = await call('/api/login/wallet', { message: m, signature: sign(m) }); ok(x.s === 200 && x.j.token && x.j.evm === EA && !x.j.custodial, '主网 EVM 登录：钱包自签，非托管');
    const users = JSON.parse(fs.readFileSync(tmp + '/data/mainnet/users.json')); ok(!JSON.stringify(users).includes('secret') && users.users['evm:' + EA] && !users.users['evm:' + EA].pubkey, '服务器没有为 EVM 账户生成 / 保管任何密钥');
    const tk = { authorization: 'Bearer ' + x.j.token }; ok((await call('/api/memo', { memo: 'x' }, tk)).s === 403, '平台仍不替任何账户代签 Solana 交易');
    console.log('server: EVM wish verification');
    const prefix = '学业', text = 't309 test wish', mod = (await call('/api/moderate', { text, prefix })).j; ok(mod.pass, '审核通过，得到审核证明');
    const memo = `WTREE1|W|${mod.attestation.hash}|${mod.attestation.ts}|${mod.attestation.sig}|${prefix}|${text}`, at = new Date().toISOString(), wsig = sign(wishMsg(EA, 8453, sha(memo), at));
    const post = (h, o = {}) => call('/api/evm/wish', { memo, addr: o.addr || EA, evm: { chainId: o.chainId || 8453, txs: [h], payKey: o.payKey }, wsig: o.wsig || wsig, issuedAt: o.at || at }); // t310：不带任何登录凭证，地址只靠签名证明
    // 1 USD = 1/3000 ETH ≈ 0.000333；容差 2%
    x = await post(addTx(H(1), { eth: 0.0003, chainId: '0x2105' })); ok(x.s === 400 && x.j.code === 'amount', '低于 1 美元（$0.90）→ 拒绝');
    x = await post(addTx(H(2), { eth: 0.00033, chainId: '0x2105' }), { wsig: sign(wishMsg(EA, 8453, sha(memo + 'x'), at)) }); ok(x.s === 400 && x.j.code === 'sig', '心愿签名与内容不符 → 拒绝');
    x = await post(addTx(H(3), { eth: 0.001, to: '0x000000000000000000000000000000000000dEaD', chainId: '0x2105' })); ok(x.s === 400 && x.j.code === 'evmTx', '收款地址不是该链 Safe → 拒绝');
    x = await post(addTx(H(4), { eth: 0.001, from: '0x1111111111111111111111111111111111111111', chainId: '0x2105' })); ok(x.s === 400 && x.j.code === 'evmTx', '付款人不是登录地址 → 拒绝');
    x = await post(addTx(H(5), { eth: 0.001, chainId: '0x2105', status: '0x0' })); ok(x.s === 400 && x.j.code === 'evmPending', '交易失败 / 未确认 → 拒绝');
    x = await post(addTx(H(6), { eth: 0.001, chainId: '0x2105', block: 999 })); ok(x.s === 400 && x.j.code === 'evmPending' && /2\/3/.test(x.j.error), '确认数不足（Base 需 3）→ 稍后重试');
    setPrice(true); x = await post(H(6)); ok(x.s === 503 && x.j.code === 'priceStale', '没有实时币价 → 不收款（不使用过期价格）'); setPrice(false);
    x = await post(H(6), { addr: '0x1111111111111111111111111111111111111111' }); ok(x.s === 400 && x.j.code === 'sig', 't310：冒充地址（签名不是该地址签的）→ 拒绝，别人无法认领这笔付款');
    HEAD.v = 1001; x = await post(H(6)); ok(x.s === 200 && x.j.signature === 'evm:8453:' + H(6) && x.j.usd === 3, '0.001 ETH（$3）+ 3 确认 → 记录心愿');
    x = await post(H(6)); ok(x.s === 400 && x.j.code === 'evmUsed', '同一笔交易不能重复使用');
    x = await post(addTx(H(7), { eth: 0.000327, chainId: '0x2105' })); ok(x.s === 200, '$0.98（报价到确认之间价格波动，2% 容差内）→ 接受');
    x = await post(addTx(H(8), { eth: 0.001, chainId: '0x2105' }), { at: new Date(Date.now() - 2 * 86400000).toISOString(), wsig: sign(wishMsg(EA, 8453, sha(memo), new Date(Date.now() - 2 * 86400000).toISOString())) }); ok(x.s === 400 && x.j.code === 'sig', '过期的心愿签名 → 拒绝');
    const atE = new Date().toISOString(); x = await post(addTx(H(9), { eth: 0.0004, to: SAFE_ETH, chainId: '0x1' }), { chainId: 1, at: atE, wsig: sign(wishMsg(EA, 1, sha(memo), atE)) }); ok(x.s === 200, 'Ethereum 主网：付到 ETH Safe 0xbfa2…2ECed → 记录');
    x = await post(addTx(H(10), { eth: 0.001, to: SAFE_ETH, chainId: '0x2105' })); ok(x.s === 400 && x.j.code === 'evmTx', 'Base 上付到 ETH 主网的 Safe 地址 → 拒绝（每链只认自己的收款地址）');
    const list = (await call('/api/evm/wishes')).j.wishes; ok(list.length === 3 && list.every(w => w.memo === memo && w.author === EA && /^evm:\d+:0x/.test(w.sig)), '/api/evm/wishes 公开列出已核验的 EVM 心愿');
    const c = (await call('/api/config')).j; ok(c.minUsd === 1 && c.minLamports === Math.ceil(1 / 150 * 1e9) && c.custody === false, 'Solana 同样最低 1 美元（按实时价换算 lamports）');
    console.log('frontend (390x844)');
    const { chromium, devices } = require('playwright'); br = await chromium.launch();
    const ctx = await br.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }), pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && console.log('   [console]', m.text()));
    const signed = []; await pg.exposeFunction('nodeSign', hex => { const m = Buffer.from(hex.slice(2), 'hex').toString('utf8'); signed.push(m); return sign(m); });
    await pg.route(/solana\.com|helius|publicnode|mainnet\.base\.org|arb1\.arbitrum|bnbchain\.org/, r => { if (/mainnet\.base\.org|arb1|bnbchain|publicnode/.test(r.request().url())) return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '' }).catch(() => {}) && r.continue({ url: MOCK }).catch(() => {}); return r.abort(); });
    await pg.unroute(/solana\.com|helius|publicnode|mainnet\.base\.org|arb1\.arbitrum|bnbchain\.org/);
    await pg.route(/mainnet\.base\.org|arb1\.arbitrum\.io|bsc-dataseed|ethereum-rpc\.publicnode/, async r => { const res = await fetch(MOCK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: r.request().postData() }); r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: await res.text() }); });
    await pg.route(/solana\.com|helius/, r => r.abort());
    await pg.addInitScript(a => { localStorage.gq_guide_dismissed = '1'; let cid = 8453; // 模拟 imKey / imToken 内置浏览器：只注入以太坊 provider，且晚 600ms 注入
      setTimeout(() => { window.ethereum = { isImToken: true, request: async ({ method, params }) => { if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [a]; if (method === 'eth_chainId') return '0x' + cid.toString(16);
        if (method === 'personal_sign') return window.nodeSign(params[0]); if (method === 'wallet_switchEthereumChain') { cid = parseInt(params[0].chainId, 16); return null; } if (method === 'wallet_requestPermissions') throw Object.assign(new Error('unsupported'), { code: 4200 }); throw new Error('unsupported ' + method); }, on() {}, removeListener() {} };
        dispatchEvent(new Event('ethereum#initialized')); }, 600); }, EA);
    await pg.goto(Bs + '/?lang=en'); await pg.waitForFunction(() => window.WTW?.cfg?.network === 'mainnet', null, { timeout: 60000 });
    await pg.evaluate(() => connectWallet()); await pg.waitForSelector('.wlist');
    await pg.waitForFunction(() => document.querySelector('[data-tab=evm].on') && [...document.querySelectorAll('.witem')].some(b => /Detected/.test(b.textContent) && b.dataset.k === 'evm'), null, { timeout: 8000 });
    const mt = await pg.textContent('#modal-box'); ok(/Ethereum \/ EVM/.test(mt) && /Base, Arbitrum and BNB Chain/.test(mt) && !/Solana wallets only|can’t log in yet/.test(mt), '登录弹窗：Ethereum 标签（以太坊内置浏览器自动选中），提示低手续费链，旧的 Solana-only 提示已移除');
    ok(await pg.evaluate(() => document.querySelector('#wch').selectedOptions[0].textContent.includes('Base')), '默认网络 = Base（低手续费）');
    fs.mkdirSync(D + '/shots', { recursive: true }); await pg.screenshot({ path: D + '/shots/t309-login.png' });
    await pg.evaluate(() => { document.querySelector('[data-tab=sol]').click(); }); await pg.waitForSelector('.wmob'); ok(/Ethereum wallet browser/.test(await pg.textContent('#modal-box')), 'Solana 标签：以太坊钱包浏览器里提示改用 Ethereum 登录');
    await pg.screenshot({ path: D + '/shots/t309-login-sol-hint.png' });
    await pg.evaluate(() => document.querySelector('[data-tab=evm]').click()); await pg.waitForSelector('.witem[data-k=evm]');
    await pg.evaluate(() => { const b = [...document.querySelectorAll('.witem[data-k=evm]')].find(b => /Detected/.test(b.textContent)); b.click(); });
    await pg.waitForFunction(() => S.kind === 'evm' && S.evmAddr, null, { timeout: 15000 }).catch(async e => { console.log(await pg.evaluate(() => JSON.stringify({ k: S.kind, m: S.mode, t: document.querySelector('#modal-box')?.innerText, toast: document.querySelector('.toast,#toast')?.innerText }))); throw e; }); await pg.waitForTimeout(800); ok(signed.length === 0 && await pg.evaluate(() => S.evmAddr === S.pubkey && S.evmRo && !S.token && !localStorage.wt_token && !S.cfg.custody), 't310：连接钱包即登录，没有弹出任何签名，也没有服务器会话 token');
    ok(await pg.evaluate(async () => { try { await api('/api/me/profile', { name: 'x' }); return false; } catch (e) { return e.code === 'evmRo'; } }), 't310：未签名的 EVM 连接不做服务器写入（资料修改等被禁用）');
    ok((await call('/api/me/profile', { name: 'x' })).s === 401, 't310：服务器端写接口不接受未签名地址（无 token → 401）');
    await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(400); await pg.screenshot({ path: D + '/shots/t310-connected.png' });
    await pg.reload(); await pg.waitForFunction(() => S.evmRo && S.kind === 'evm' && S.mode === 'host', null, { timeout: 30000 }); ok(signed.length === 0, 't310：刷新后自动恢复连接，仍不签名');
    await pg.evaluate(() => { location.hash = '#/wish/make'; }); await pg.waitForSelector('#evc', { timeout: 15000 });
    await pg.waitForFunction(() => /≈ \$/.test(document.querySelector('#evfee')?.textContent || ''), null, { timeout: 15000 });
    const wt = await pg.evaluate(() => ({ fee: $('#evfee').textContent, min: $('#evmin').textContent, opts: [...$('#evc').options].map(o => o.textContent), pvHidden: $('#pv').closest('label').hidden, solOpt: !!document.querySelector('#pv option[value=sol]'), rule: document.querySelector('.evrule').textContent }));
    ok(/1 USD/.test(wt.min) && /Estimated network fee/.test(wt.fee) && /1 USD/.test(wt.rule), '心愿页：最低 1 美元（实时价）+ 付款前显示预计网络手续费 ' + wt.fee);
    ok(/^Base/.test(wt.opts[0]) && /Ethereum.*higher fee/.test(wt.opts[wt.opts.length - 1]) && wt.pvHidden && !wt.solOpt, '链顺序：Base / Arbitrum / BNB 在前，Ethereum 标注 higher fee；非托管不再提供“Solana 代付”');
    await pg.evaluate(() => { $('#evc').scrollIntoView({ block: 'center' }); }); await pg.screenshot({ path: D + '/shots/t309-evm-pay.png' });
    await pg.selectOption('#evc', 'eth'); await pg.waitForFunction(() => /Ethereum mainnet is supported/.test($('#evlow').textContent) && /≈ \$/.test($('#evfee').textContent), null, { timeout: 15000 }); await pg.evaluate(() => { $('#evc').scrollIntoView({ block: 'center' }); }); await pg.screenshot({ path: D + '/shots/t309-evm-wish-eth.png' }); ok(true, '选 Ethereum：提示手续费较高');
    await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForTimeout(500);
    ok(await pg.evaluate(async () => { await loadEvmWishes(); aggregate(); return S.wishes.filter(w => /^evm:/.test(w.sig)).length === 3 && /basescan\.org\/tx\/0x/.test(EXPLORER(S.wishes.find(w => /^evm:8453/.test(w.sig)).sig)); }), '树上：EVM 心愿与 Solana 心愿同树显示，链接指向对应链的浏览器');
    ok(!errs.length, '页面无 JS 错误 ' + errs.join('|'));
  } finally { await br?.close(); srv.kill(); rpcSrv.close(); }
  console.log(`\n✅ ${n} checks passed`); process.exit(0);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });

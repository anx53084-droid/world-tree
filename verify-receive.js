// 收款地址配置验证：各链新地址 / 历史地址、EIP-55 校验和、Solana 金库 off-curve 的交易构造、服务端校验（当前 + 历史）、/api/config 输出、环境变量只作历史地址。全部离线 / 模拟，不发任何真实交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), web3 = require('@solana/web3.js');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const NEW = { sol: 'FPKFevoHzjPZWjWaRxwFwfNXu2LBduoGspXZSCLU81yz', eth: '0xbfa2C12D28838bEA6C92645c195fAa907182ECed', bsc: '0x71c04f3C4922d1A6FA2724428d4E2c51f5445837', base: '0x257ae349424c3047a3Acbe02351520d8e5Bd6458', arb: '0x257ae349424c3047a3Acbe02351520d8e5Bd6458', uni: '0x4BF1746F3e83b1fb87c9058850B4442cC9AbD740' };
const OLD = { sol: '2Xjes9L3kePHUKyQaFfueHr933d6V71rPSSF3zZxL6pc', eth: '0x257ae349424c3047a3acbe02351520d8e5bd6458', bsc: '0x03247ce2bf38bd5e570f13ef7020f4956e350797' };
console.log('config'); const RC = require('./receive-config');
ok(RC.sol.address === NEW.sol, 'Solana 当前收款地址 = Squads 金库 FPKF…81yz');
for (const k of ['eth', 'bsc', 'base', 'arb', 'uni']) ok(RC.evm[k].address === NEW[k] && RC.evm[k].lower === NEW[k].toLowerCase(), k + ' 当前收款地址 = ' + NEW[k] + '（EIP-55 校验和与给定一致）');
ok(RC.evm.base.address === RC.evm.arb.address && RC.evm.base.address === '0x257ae349424c3047a3Acbe02351520d8e5Bd6458' && RC.evm.uni.address === NEW.uni, 'Base / Arbitrum / UNI 保持原地址（尚未部署 Safe）');
ok(RC.legacy.sol.includes(OLD.sol) && RC.legacy.evm.eth.includes(OLD.eth) && RC.legacy.evm.bsc.includes(OLD.bsc) && !RC.legacy.sol.includes(NEW.sol), '旧地址保留为历史收款地址（sol / eth / bsc），当前地址不在历史里');
ok(RC.isSolRecv(NEW.sol) && RC.isSolRecv(OLD.sol) && !RC.isSolRecv('11111111111111111111111111111111') && !RC.isSolRecv(''), 'Solana：当前 + 历史地址被识别，其它拒绝');
ok(RC.isEvmRecv('eth', NEW.eth) && RC.isEvmRecv('eth', NEW.eth.toLowerCase()) && RC.isEvmRecv('eth', OLD.eth) && !RC.isEvmRecv('eth', NEW.bsc) && !RC.isEvmRecv('bsc', NEW.eth) && !RC.isEvmRecv('bsc', OLD.eth) && RC.isEvmRecv('bsc', OLD.bsc), 'EVM：按链识别当前 + 历史地址（大小写不敏感），不串链');
console.log('solana vault (off-curve)'); const vault = new web3.PublicKey(RC.sol.address);
ok(!web3.PublicKey.isOnCurve(vault.toBytes()), '金库是 off-curve 的 PDA');
const payer = web3.Keypair.generate(), tx = new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vault, lamports: 1000000 })); tx.recentBlockhash = '11111111111111111111111111111111'; tx.feePayer = payer.publicKey; tx.sign(payer);
ok(tx.serialize().length > 0 && tx.verifySignatures(), '向 off-curve 金库的 System Program 转账：构造 / 序列化 / 签名均不报错');
const msg = new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vault, lamports: 5 })); ok(msg.instructions[0].keys[1].pubkey.equals(vault), '转账指令的收款账户 = 金库');
// 服务端 server.js 中的 buildMemoTx 用同一个 RECEIVE
const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'); ok(/toPubkey: RECEIVE/.test(srv) && /RC\.isSolRecv\(p\.info\.destination\)/.test(srv) && /RC\.sol\.address/.test(srv), '服务端：交易构造用 RECEIVE（来自配置），校验用 isSolRecv（当前 + 历史）');
ok(!/process\.env\.RECEIVE_PUBKEY/.test(srv) && !/payees\.json/.test(srv), '服务端不再由环境变量 / 本地密钥文件决定收款地址');
console.log('evm verification (mock RPC)'); const Acc = require('./account');
const mk = (to, from, val = 5n * 10n ** 15n) => ({ tx: { from, to, value: '0x' + val.toString(16), chainId: '0x1' }, rc: { status: '0x1' } });
let nextTx = null; global.fetch = async (u, init) => { const b = JSON.parse(init.body); return { json: async () => ({ result: b.method === 'eth_getTransactionByHash' ? nextTx.tx : nextTx.rc }) }; };
const FROM = '0x2361e4b9458c2b2bc99fb3072b023662bfa57e20'; let hn = 0; const H = () => '0x' + (++hn).toString(16).padStart(64, '0');
const pay = async (chainId, to, payKey) => { nextTx = mk(to, FROM); nextTx.tx.chainId = '0x' + chainId.toString(16); try { await Acc.verifyEvmPay({}, { chainId, txs: [H()], payKey }, FROM, 3000, 1); return 'ok'; } catch (e) { return e.code || e.message; } };
(async () => {
  ok(await pay(11155111, NEW.eth) === 'ok' && await pay(11155111, NEW.eth.toLowerCase()) === 'ok', 'eth 链：付到新 Safe 地址 → 通过');
  ok(await pay(11155111, OLD.eth) === 'ok', 'eth 链：付到旧地址（历史）→ 过渡期仍识别');
  ok(await pay(97, NEW.bsc) === 'ok' && await pay(97, OLD.bsc) === 'ok', 'bsc 链：新 Safe L2 与旧地址均通过');
  ok(await pay(97, NEW.eth) === 'evmTx' && await pay(97, '0x000000000000000000000000000000000000dEaD') === 'evmTx', 'bsc 链：付到 eth 的地址 / 陌生地址 → 拒绝');
  ok(await pay(84532, NEW.base) === 'ok' && await pay(421614, NEW.arb) === 'ok' && await pay(1301, NEW.uni) === 'ok', 'base / arb / uni：原地址仍通过');
  ok(await pay(84532, NEW.eth) === 'evmTx', 'base 链：付到 eth 新地址 → 拒绝（各链按各自配置）');
  // ---- /api/config 与旧环境变量 ----
  console.log('api/config + env'); const D = __dirname, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-rcv-')), port = 18899, B = 'http://127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  const EXTRA_SOL = web3.Keypair.generate().publicKey.toBase58(), EXTRA_EVM = '0x1111111111111111111111111111111111111111';
  const p = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', RECEIVE_PUBKEY: EXTRA_SOL, EVM_PAY_ETH: EXTRA_EVM }, stdio: 'ignore' });
  try { for (let i = 0; i < 80; i++) { try { await (await fetch(B + '/api/nonce')).text(); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const real = require('node:http'); const get = u => new Promise((res, rej) => real.get(B + u, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));
    const c = await get('/api/config');
    ok(c.receive === NEW.sol && c.developer === NEW.sol && c.treasury === NEW.sol, '/api/config.receive = 新 Solana 金库（旧环境变量 RECEIVE_PUBKEY 不再覆盖）');
    ok(c.evm.recipients.eth === NEW.eth && c.evm.recipients.bsc === NEW.bsc && c.evm.recipients.base === NEW.base && c.evm.recipients.arb === NEW.arb && c.evm.recipients.uni === NEW.uni && c.evm.routes.eth.receive === NEW.eth && c.evm.chains[11155111].receive === NEW.eth, '/api/config 各链收款地址（recipients / routes / chains）= 新配置');
    ok(c.receiveLegacy.includes(OLD.sol) && c.receiveLegacy.includes(EXTRA_SOL) && c.evm.legacy.eth.includes(OLD.eth) && c.evm.legacy.eth.includes(EXTRA_EVM) && c.evm.legacy.bsc.includes(OLD.bsc), '旧地址（含环境变量里的旧值）只出现在 legacy 字段，用于校验已有记录');
    ok(!JSON.stringify(c.evm.recipients).includes(OLD.bsc) && c.receive !== OLD.sol, '展示字段里不含旧地址');
    // ads 商家接口返回当前收款地址（需要登录；这里只检查静态 UI 引用）
    const app = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'); ok(/id=turecv>\$\{esc\(M\.receive \|\| S\.cfg\.receive/.test(app) && /id=recvaddr/.test(app) && /receiveLegacy/.test(app), '前端：追加弹窗 / 许愿支付界面显示配置里的收款地址；统计转账时识别历史地址');
    const hard = ['FPKFevoHz', '0xbfa2C12D', '0x71c04f3C', '0x257ae349', '0x4BF1746F', '2Xjes9L3k', '0x03247ce2']; const files = ['server.js', 'account.js', 'ads.js', 'gate.js', 'fulfillment.js', 'goods.js', 'social.js', 'public/app.js'].filter(f => fs.existsSync(path.join(__dirname, f)));
    ok(files.every(f => hard.every(h => !fs.readFileSync(path.join(__dirname, f), 'utf8').includes(h))), '地址只写在 receive-config.js，其它源码里没有硬编码');
  } finally { p.kill(); }
  console.log(`\n✅ ${n} checks passed`); process.exit(0);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });

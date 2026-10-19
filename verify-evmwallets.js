// EVM 钱包：WalletConnect（eip155）+ Dynamic 邮箱 / Google 嵌入式 EVM 钱包 + Trust / Bitget 深链接。vendor 以页面内模拟替换，签名用本地测试私钥，不连接真实钱包、不发任何交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
const { chromium, devices } = require('playwright'); const { secp256k1 } = require('@noble/curves/secp256k1'); const { keccak_256 } = require('@noble/hashes/sha3');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); }; const D = __dirname;
const PK = keccak_256(new TextEncoder().encode('wt-evm-test-key')), hx = b => Buffer.from(b).toString('hex');
const ADDR = '0x' + hx(keccak_256(secp256k1.getPublicKey(PK, false).slice(1)).slice(-20));
const sign = msgHex => { const m = Buffer.from(msgHex.slice(2), 'hex'), h = keccak_256(Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n' + m.length), m])), s = secp256k1.sign(h, PK); return '0x' + s.toCompactHex() + (27 + s.recovery).toString(16); };
const MOCK_PROV = `const mkP = (ch, onUri) => { const L = {}; return { on: (e, f) => (L[e] ||= []).push(f), removeListener() {}, disconnect: async () => {}, request: async ({ method, params }) => {
  if (method === 'eth_requestAccounts') { if (onUri) { onUri('wc:abc123@2?relay-protocol=irn&symKey=00'); await new Promise(r => setTimeout(r, 700)); } return ['${ADDR}']; }
  if (method === 'eth_accounts') return ['${ADDR}']; if (method === 'eth_chainId') return '0x' + ch.toString(16);
  if (method === 'wallet_switchEthereumChain') { ch = parseInt(params[0].chainId, 16); return null; } if (method === 'wallet_requestPermissions') throw Object.assign(new Error('x'), { code: 4200 });
  if (method === 'personal_sign') { window.__signed = (window.__signed || 0) + 1; return await window.nodeSign(params[0]); } throw Object.assign(new Error('unsupported ' + method), { code: 4200 }); } }; };`;
(async () => {
  console.log('vendor'); const wc = fs.readFileSync(D + '/scripts/vendor-src/wc.js', 'utf8'), dy = fs.readFileSync(D + '/scripts/vendor-src/dynamic.js', 'utf8');
  ok(/createEvm/.test(wc) && /eip155/.test(wc) && /personal_sign/.test(wc) && /eth_sendTransaction/.test(wc) && /wallet_switchEthereumChain/.test(wc) && /wt-evm/.test(wc), 'WalletConnect vendor：eip155 命名空间 + personal_sign / eth_sendTransaction / 切链，会话前缀与 Solana 分开');
  ok(/addWaasEvmExtension/.test(dy) && /evmProvider/.test(dy) && /evmEnabled/.test(dy) && /dynNoEvm/.test(dy), 'Dynamic vendor：EVM 嵌入式钱包扩展 + EIP-1193 provider + 启用检测');
  ok(/createEvm/.test(fs.readFileSync(D + '/public/vendor/walletconnect.js', 'utf8')) && /evmEnabled/.test(fs.readFileSync(D + '/public/vendor/dynamic.js', 'utf8')), 'public/vendor 已用新源码重新打包');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-evmw-')), port = 18941, Bs = 'http://127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data', { recursive: true });
  fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '', PRICE_MOCK: '1', WC_PROJECT_ID: 'pid-test', DYNAMIC_ENV_ID: 'env-test' }, stdio: 'ignore' });
  let b; try { for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = async (dyn = {}) => { const c = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 412, height: 860 } }); const p = await c.newPage(); await p.exposeFunction('nodeSign', sign); await p.addInitScript(() => { localStorage.gq_guide_dismissed = '1'; });
      await p.route('**/vendor/walletconnect.js', r => r.fulfill({ contentType: 'text/javascript', body: `${MOCK_PROV} window.WTWC = { createEvm: o => { window.__wcOpts = o; return mkP(84532, o.onUri); } };` }));
      await p.route('**/vendor/dynamic.js', r => r.fulfill({ contentType: 'text/javascript', body: `${MOCK_PROV} let ea = null; window.WTDYN = { init: async () => {}, address: () => null, evmAddress: () => ea, evmEnabled: () => ${dyn.evm !== false}, evmNetworks: () => [1], ensureWallet: async () => { ea = '${ADDR}'; },
        sendEmail: async e => ({ e }), verify: async (o, c, ch) => { window.__dynChain = ch; if (c !== '123456') throw new Error('bad code'); ea = '${ADDR}'; }, evmProvider: rpc => { window.__dynRpc = typeof rpc; return mkP(1); }, logout: async () => {} };` }));
      await p.goto(Bs + '/?lang=zh-CN'); await p.waitForFunction(() => window.WTW && typeof S !== 'undefined' && S.cfg?.evm, null, { timeout: 60000 }); return p; };
    const T = JSON.parse(fs.readFileSync(D + '/public/i18n/zh-CN.json', 'utf8')), toastHas = (p, s) => p.waitForFunction(s => [...document.querySelectorAll('.toast')].some(x => x.textContent.includes(s)), s, { timeout: 15000 });
    console.log('wallet list');
    let p = await page(); await p.evaluate(() => connectWallet('evm')); await p.waitForSelector('.wlist');
    const items = await p.$$eval('.wlist .witem', a => a.map(x => (x.dataset.w || '') + '|' + x.textContent));
    ok(items.some(x => x.startsWith('walletconnect|')) && items.some(x => x.startsWith('dynamic|')), 'EVM 列表包含 WalletConnect 与邮箱 / Google 登录（Dynamic）');
    ok(items.some(x => x.includes('Trust Wallet')) && items.some(x => x.includes('Bitget')), '手机无注入钱包：Trust Wallet / Bitget 以深链接出现');
    ok(await p.$$eval('.wdeep', a => a.some(x => /link\.trustwallet\.com/.test(x.href)) && a.some(x => /bkcode\.vip/.test(x.href))), 'Trust / Bitget 深链接指向各自 App 内置浏览器');
    ok(!items.some(x => x.includes(T['wal.mwa'])) && !(await p.$('.wlist .witem.rec')), 'EVM 标签下没有 Mobile Wallet Adapter 入口');
    ok(items.find(x => x.startsWith('dynamic|')).includes(T['wal.dynSubEvm']), 'Dynamic 项副标题为 EVM 文案');
    ok(!/(平台代付|平台代发|由平台承担|gas ?由平台|还愿|收益)/i.test(Object.entries(T).filter(([k]) => /^wal\.(dyn|wc)/.test(k)).map(x => x[1]).join(' ')), '钱包文案不含平台代付 gas 类表述');
    console.log('walletconnect');
    await p.click('.witem[data-w=walletconnect]'); await p.waitForSelector('#wcwait'); ok(await p.$('.qr svg') !== null, '点 WalletConnect：显示二维码 + 打开钱包按钮');
    ok(await p.evaluate(() => { const o = window.__wcOpts; return o.projectId === 'pid-test' && [11155111, 84532, 421614, 97].every(c => o.chains.includes(c)) && typeof o.rpc === 'function' && /^https:/.test(o.rpc(84532)); }), 'createEvm 参数：同一 Reown project、四条测试网、公共 RPC');
    await p.waitForFunction(() => localStorage.wt_evm === 'walletconnect' && S.kind === 'evm', null, { timeout: 15000 });
    ok(await p.evaluate(() => window.__signed === 1), 'WalletConnect 登录：personal_sign → 现有 EVM 登录接口通过');
    ok((await p.textContent('#acard')).includes(T['acct.idEvm']), '账户卡片显示 EVM 钱包身份');
    await p.context().close();
    console.log('dynamic off');
    p = await page({ evm: false }); await p.evaluate(() => connectWallet('evm')); await p.click('.witem[data-w=dynamic]'); await toastHas(p, T['wal.dynEvmOff']); ok(true, '后台未启用 EVM 嵌入式钱包：友好提示，不报错');
    ok(await p.evaluate(() => !S.kind || S.kind !== 'evm'), '未启用时不登录'); await p.context().close();
    console.log('dynamic evm');
    p = await page(); await p.evaluate(() => connectWallet('evm')); await p.click('.witem[data-w=dynamic]'); await p.waitForSelector('#dem');
    ok((await p.textContent('.modal, #modal')).includes(T['wal.dynHintEvm']) && await p.$('#dgg') !== null, '邮箱登录入口：EVM 提示（地址与 Solana 不同）+ Google 按钮');
    await p.fill('#dem', 'evm@test.dev'); await p.click('#dsend'); await p.waitForSelector('#dcode'); await p.fill('#dcode', '123456'); await p.click('#dver');
    await p.waitForFunction(() => localStorage.wt_evm === 'dynamic' && S.kind === 'evm', null, { timeout: 15000 });
    ok(await p.evaluate(() => window.__dynChain === 'EVM' && window.__signed === 1 && window.__dynRpc === 'function'), 'Dynamic：验证码按 EVM 链创建钱包，personal_sign 登录');
    await toastHas(p, T['wal.dynEvmNet'].split('{')[0].slice(0, 6)); ok(true, '所选测试网未在后台启用：提示（登录照常）');
    ok((await p.textContent('#acard')).includes(T['acct.idDynEvm']), '账户卡片显示「邮箱钱包持有者（EVM）」');
    await p.context().close();
    console.log(`\nverify-evmwallets: ${n} checks passed`);
  } finally { await b?.close(); srv.kill(); }
})().catch(e => { console.error('FAIL', e); process.exit(1); });

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
    const page = async (dyn = {}) => { const urls = []; const c = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 412, height: 860 } }); const p = await c.newPage(); await p.exposeFunction('nodeSign', sign); await p.addInitScript(ev => { localStorage.gq_guide_dismissed = '1'; if (ev) window.WT_WALLET_UI = { evmTab: true, email: true }; }, dyn.ui !== 'default');
      await p.route('**/vendor/walletconnect.js*', r => { urls.push(r.request().url()); if (dyn.stale && !/[?&]r=/.test(r.request().url())) return r.fulfill({ contentType: 'text/javascript', body: 'window.WTWC = { create() {} };' }); return r.fulfill({ contentType: 'text/javascript', body: `${MOCK_PROV} window.WTWC = { createEvm: o => { window.__wcOpts = o; return mkP(84532, o.onUri); } };` }); });
      await p.route('**/vendor/dynamic.js*', r => { urls.push(r.request().url()); if (dyn.stale && !/[?&]r=/.test(r.request().url())) return r.fulfill({ contentType: 'text/javascript', body: 'window.WTDYN = { init: async () => {}, adapter() {}, address: () => null };' }); return r.fulfill({ contentType: 'text/javascript', body: `${MOCK_PROV} let ea = null; window.WTDYN = { init: async () => {}, address: () => null, evmAddress: () => ea, evmEnabled: () => ${dyn.evm !== false}, evmNetworks: () => [1], ensureWallet: async () => { ea = '${ADDR}'; },
        sendEmail: async e => ({ e }), verify: async (o, c, ch) => { window.__dynChain = ch; if (c !== '123456') throw new Error('bad code'); ea = '${ADDR}'; }, evmProvider: rpc => { window.__dynRpc = typeof rpc; return mkP(1); }, logout: async () => {} };` }); });
      await p.goto(Bs + '/?lang=zh-CN'); await p.waitForFunction(() => window.WTW && typeof S !== 'undefined' && S.cfg?.evm, null, { timeout: 60000 }); p.urls = urls; return p; };
    const T = JSON.parse(fs.readFileSync(D + '/public/i18n/zh-CN.json', 'utf8')), toastHas = (p, s) => p.waitForFunction(s => [...document.querySelectorAll('.toast')].some(x => x.textContent.includes(s)), s, { timeout: 15000 });
    console.log('default wallet modal (t219u)');
    { const q = await page({ ui: 'default' }); await q.evaluate(() => connectWallet('evm')); await q.waitForSelector('.wlist');
      ok(!(await q.$('[data-tab]')) && !(await q.$('#wch')), '默认：EVM 标签整体隐藏（即使请求 EVM 也只显示 Solana），只剩一个链时不显示标签切换');
      const ids = await q.$$eval('.wlist .witem', a => a.map(x => x.dataset.w || (x.textContent.includes('Phantom') ? 'phantom' : x.textContent.trim().slice(0, 12))));
      ok(!ids.some(x => /solflare|backpack|okx/i.test(x)), '默认：隐藏 Solflare / Backpack / OKX Wallet');
      ok(ids[0] === 'phantom' && ids[ids.length - 1] === 'walletconnect' && !ids.includes('dynamic'), '默认顺序：Phantom → (MWA) → WalletConnect，邮箱 / Google 隐藏（t220u）：' + ids.join(','));
      await q.evaluate(() => closeModal()); ok(!(await q.$('#be')) && !(await q.$('[data-cta=email]')) && (await q.textContent('#acard')).includes(T['acct.guestHintW']), '默认：未登录账户卡与引导里没有邮箱登录按钮，提示改为只连钱包');
      ok(!(await q.$('.wmob')) && !(await q.textContent('#modal-box')).includes(T['wal.solHint']), '说明文字精简：去掉 Solana 支持列表与手机提示');
      ok(await q.evaluate(() => WTW.solWallets().some(w => w.id === 'solflare') && WTW.evmWallets().some(w => w.id === 'walletconnect')), '隐藏只作用于入口：钱包代码保留（已有会话照常恢复）');
      await q.context().close(); }
    console.log('devnet guide (t222u)');
    { const q = await page({ ui: 'default' }); await q.evaluate(() => connectWallet()); await q.waitForSelector('.wlist');
      ok(await q.$eval('.wlist .wdev', e => !e.open && /Devnet/.test(e.textContent)) && await q.$eval('.wlist', l => { const k = [...l.children]; const i = k.findIndex(x => x.classList.contains('wdev')); return i > 0 && /Phantom|MWA/.test(k[i - 1].textContent); }), '钱包弹窗：Phantom / MWA 下方有折叠的 Devnet 提示（如何开启）');
      await q.click('.wdev summary'); ok(await q.$eval('.wdev', (e, x) => e.open && e.textContent.includes(x), T['wal.devSteps']), '点「如何开启」展开开启步骤');
      await q.evaluate(() => { closeModal(); toast(esc(walErr({ code: 4001, message: 'User rejected the request.' })), 'err'); }); await toastHas(q, T['wal.devRejected'].slice(0, 8)); ok(true, 'Solana 钱包拒绝（关闭「模式不正确」弹窗后的返回）→ Devnet 引导文案，不显示原始报错');
      await q.evaluate(() => toast(esc(walErr(new Error('guangqi.world is trying to use testnet, but you are not in testnet mode'))), 'err')); await q.waitForSelector('#devguide', { timeout: 5000 }); ok((await q.textContent('#modal-box')).includes(T['wal.devS2']) && !(await q.textContent('#toasts')).includes('trying to use testnet'), '识别到模式 / 网络不匹配 → 弹出开启测试网模式引导');
      await q.evaluate(() => closeModal()); await q.evaluate(() => toast(esc(walErr(new Error('Unexpected error 0x1234'))), 'err')); await toastHas(q, T['wal.devGeneric']); ok(!(await q.textContent('#toasts')).includes('0x1234'), '识别不了的 Solana 钱包错误 → 通用「请确认钱包处于 Devnet」提示');
      await q.evaluate(() => { S.evmBusy = true; }); ok(await q.evaluate(() => walErr({ code: 4001 })) === T['wal.rejected'], 'EVM 场景不受影响（仍是普通拒绝提示）');
      await q.context().close(); }
    { const q = await page({ ui: 'default' }); await q.addInitScript(() => { window.phantom = { solana: { isPhantom: true, on() {}, connect: async () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); } } }; }); await q.reload(); await q.waitForFunction(() => window.WTW && typeof S !== 'undefined' && S.cfg?.evm);
      await q.evaluate(() => connectWallet()); await q.click('.witem[data-w=phantom]'); await toastHas(q, T['wal.devRejected'].slice(0, 8)); ok(true, '真实连接流程：Phantom 连接被拒 → Devnet 引导'); await q.screenshot({ path: '/tmp/devrej.png' }); await q.context().close(); }
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
    console.log('copy address');
    { const c = await b.newContext({ viewport: { width: 412, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] }); const q = await c.newPage(); await q.addInitScript(() => { localStorage.gq_guide_dismissed = '1'; });
      await q.goto(Bs + '/?lang=zh-CN'); const lg = await (await fetch(Bs + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'copy@test.dev' }) })).json();
      await q.evaluate(t => { localStorage.wt_token = t; }, lg.token); await q.reload(); await q.waitForSelector('#wscp', { timeout: 30000 });
      ok(await q.$('#bo') !== null && (await q.textContent('#acard')).includes(T['acct.idHost']), '邮箱入口隐藏后：已登录的邮箱会话照常显示、可退出'); await q.click('#wscp'); await toastHas(q, T['wal.addrCopied']); ok(await q.evaluate(() => navigator.clipboard.readText()) === lg.pubkey, '顶栏地址胶囊复制按钮：复制完整地址，提示「已复制」');
      ok(await q.$('#accp') !== null && await q.$eval('#accp', e => e.dataset.addr) === lg.pubkey && await q.$eval('#accp', e => !!e.getAttribute('aria-label')), '抽屉账户卡地址后有复制按钮（完整地址、无障碍标签）');
      ok(Object.keys(JSON.parse(fs.readFileSync(D + '/public/i18n/en.json', 'utf8'))).includes('wal.addrCopied'), '「已复制」文案在词典中'); await c.close(); }
    console.log('stale vendor cache');
    p = await page({ stale: true }); await p.evaluate(() => connectWallet('evm')); await p.click('.witem[data-w=walletconnect]'); await p.waitForSelector('#wcwait', { timeout: 15000 });
    ok(p.urls.length === 2 && /\?v=[0-9a-f]{10}$/.test(p.urls[0]) && /[?&]r=/.test(p.urls[1]), '旧版 walletconnect.js（缺 createEvm）：带内容哈希加载，特性检测后破缓存重载，不报 “not a function”');
    await p.waitForFunction(() => localStorage.wt_evm === 'walletconnect', null, { timeout: 15000 }); ok(true, '重载后 WalletConnect 登录照常');
    await p.context().close(); p = await page({ stale: true });
    await p.evaluate(() => connectWallet('evm')); await p.click('.witem[data-w=dynamic]'); await p.waitForSelector('#dem', { timeout: 15000 }); ok(p.urls.filter(u => /dynamic/.test(u)).length === 2, '旧版 dynamic.js（缺 evmProvider，复现 06:00 截图）：自动重载新版，邮箱登录入口正常打开');
    await p.fill('#dem', 'evm@test.dev'); await p.click('#dsend'); await p.waitForSelector('#dcode'); await p.fill('#dcode', '123456'); await p.click('#dver'); await p.waitForFunction(() => localStorage.wt_evm === 'dynamic', null, { timeout: 15000 }); ok(true, '重载后 EVM 邮箱登录走通');
    await p.context().close(); p = await page({ stale: true }); await p.route('**/vendor/dynamic.js*', r => r.fulfill({ contentType: 'text/javascript', body: 'window.WTDYN = { init: async () => {}, adapter() {} };' }));
    await p.evaluate(() => connectWallet('evm')); await p.click('.witem[data-w=dynamic]'); await toastHas(p, T['wal.vendorOld']); ok(true, '始终拿到旧版：提示刷新页面（可读文案），不出现 “not a function”'); await p.context().close();
    console.log(`\nverify-evmwallets: ${n} checks passed`);
  } finally { await b?.close(); srv.kill(); }
})().catch(e => { console.error('FAIL', e); process.exit(1); });

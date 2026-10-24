// 多链钱包：Solana（Wallet Standard + 注入式：Phantom / Solflare / Backpack / OKX + MWA / Dynamic / WalletConnect）与 EVM（EIP-6963 + 注入式：MetaMask / OKX / Coinbase / Trust / Bitget + Dynamic / WalletConnect；MWA 仅 Solana）
// 非托管：只请求连接、签名消息和发送交易；私钥永远留在钱包里。移动端未检测到钱包时用深链接在钱包内置浏览器中打开本站。
(function () {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = u => { let n = 0n; for (const x of u) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const x of u) { if (x) break; s = '1' + s; } return s; };
  const toU8 = x => x instanceof Uint8Array ? x : x?.signature ? toU8(x.signature) : Array.isArray(x) ? Uint8Array.from(x) : new Uint8Array(x);
  const here = () => location.href, enc = encodeURIComponent;
  // ---- Solana：Wallet Standard 发现 ----
  const std = new Map();
  const reg = (...ws) => { for (const w of ws) if (w?.features?.['standard:connect'] && (w.features['solana:signAndSendTransaction'] || w.features['solana:signTransaction'] || /mobile wallet adapter/i.test(w.name)) && (w.chains || []).some(c => c.startsWith('solana:'))) std.set(w.name, w); return () => {}; }; // MWA 的签名能力要授权后才出现，所以按名称放行
  try { addEventListener('wallet-standard:register-wallet', e => { try { e.detail({ register: reg }); } catch {} });
    dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: reg } })); } catch {}
  const SOL = [ // 固定展示的四个钱包：检测名称 / 注入对象 / 移动端深链接
    { id: 'phantom', name: 'Phantom', inj: () => window.phantom?.solana?.isPhantom && window.phantom.solana, deep: () => `https://phantom.com/ul/browse/${enc(here())}?ref=${enc(location.origin)}`, site: 'https://phantom.com/' },
    { id: 'solflare', name: 'Solflare', inj: () => window.solflare?.isSolflare && window.solflare, deep: () => `https://solflare.com/ul/v1/browse/${enc(here())}?ref=${enc(location.origin)}`, site: 'https://solflare.com/' },
    { id: 'backpack', name: 'Backpack', inj: () => window.backpack?.isBackpack && window.backpack, deep: () => `https://backpack.app/ul/v1/browse/${enc(here())}?ref=${enc(location.origin)}`, site: 'https://backpack.app/' },
    { id: 'okx', name: 'OKX Wallet', inj: () => window.okxwallet?.solana, deep: () => `okx://wallet/dapp/url?dappUrl=${enc(here())}`, site: 'https://www.okx.com/web3' }];
  function stdAdapter(w, id) { let acct = null; const F = new Proxy({}, { get: (_, k) => w.features[k] }); // 每次读取最新 features（MWA 授权后才有 signAndSend / signTransaction）
    return { id, name: w.name, icon: w.icon, std: true,
      async connect(silent) { const r = await F['standard:connect'].connect(silent ? { silent: true } : undefined); acct = (r?.accounts || w.accounts)[0]; if (!acct) throw new Error('no account'); return acct.address; },
      async signAndSend(tx) { const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        if (F['solana:signAndSendTransaction']) { const [o] = await F['solana:signAndSendTransaction'].signAndSendTransaction({ account: acct, transaction: bytes, chain: WTW.cfg.solChain || 'solana:devnet' }); return b58(toU8(o.signature)); }
        const [o] = await F['solana:signTransaction'].signTransaction({ account: acct, transaction: bytes, chain: WTW.cfg.solChain || 'solana:devnet' }); return { raw: toU8(o.signedTransaction) }; },
      async signMessage(m) { if (!F['solana:signMessage']) throw new Error('signMessage unsupported'); const [o] = await F['solana:signMessage'].signMessage({ account: acct, message: m }); return toU8(o.signature); },
      canSignIn: !!F['solana:signIn'],
      async signIn(input) { if (id === 'mwa') window.WTMWA?.fresh?.(); const [o] = await F['solana:signIn'].signIn(input); acct = o.account; return { address: o.account.address, message: new TextDecoder().decode(toU8(o.signedMessage)), signature: toU8(o.signature) }; },
      onChange(cb) { try { return F['standard:events']?.on('change', ch => { if (ch.accounts) cb(ch.accounts[0]?.address || null); }); } catch {} },
      async disconnect() { try { await F['standard:disconnect']?.disconnect(); } catch {} } }; }
  function injAdapter(p, d) { let pk = null;
    return { id: d.id, name: d.name,
      async connect(silent) { const r = await p.connect(silent ? { onlyIfTrusted: true } : undefined); pk = (r?.publicKey || p.publicKey)?.toString(); if (!pk) throw new Error('no account'); return pk; },
      async signAndSend(tx) { const r = await p.signAndSendTransaction(tx); return typeof r === 'string' ? r : r.signature || r.publicKey && r; },
      async signMessage(m) { return toU8(await p.signMessage(m, 'utf8')); },
      canSignIn: typeof p.signIn === 'function',
      async signIn(input) { const o = await p.signIn(input); pk = (o.address || o.account?.address || p.publicKey)?.toString(); return { address: pk, message: new TextDecoder().decode(toU8(o.signedMessage)), signature: toU8(o.signature) }; },
      onChange(cb) { try { p.on?.('accountChanged', k => cb(k ? k.toString() : null)); p.on?.('disconnect', () => cb(null)); } catch {} },
      async disconnect() { try { await p.disconnect?.(); } catch {} } }; }
  const b58dec = s => { let n = 0n; for (const c of s) { const i = A.indexOf(c); if (i < 0) throw new Error('b58'); n = n * 58n + BigInt(i); } const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== '1') break; out.unshift(0); } return Uint8Array.from(out); };
  let cfgDone; const cfgReady = new Promise(r => cfgDone = r); // /api/config 到达后才知道网络（MWA 注册需要 chain）
  const loadJs = src => new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = vsrc(src); sc.onload = ok; sc.onerror = () => no(new Error('load ' + src)); document.head.append(sc); });
  // vendor 脚本带内容哈希（来自 <meta name=wt-vendor>，stamp.js 生成）：部署后不会拿到浏览器 / SW 缓存里的旧版
  function vsrc(src, bust) { const m = /^vendor\/([\w.\-]+\.js)$/.exec(src); if (!m) return src; const h = (document.querySelector('meta[name=wt-vendor]')?.content || '').split(',').map(x => x.split(':')).find(x => x[0] === m[1])?.[1];
    const q = [h && 'v=' + h, bust && 'r=' + bust].filter(Boolean).join('&'); return q ? src + '?' + q : src; }
  // 按需加载 vendor 并做特性检测：已加载 / 缓存的是旧版（缺少所需函数）时带新哈希 + 破缓存参数重新加载；仍缺则给出可读错误（code vendorOld），而不是 “x is not a function”
  async function needVendor(src, g, fn) { const has = () => typeof window[g]?.[fn] === 'function'; if (has()) return window[g];
    const load = bust => new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = vsrc(src, bust); sc.onload = ok; sc.onerror = () => no(new Error('load ' + src)); document.head.append(sc); });
    if (!window[g]) await load(); if (!has()) { await load(Date.now().toString(36)).catch(() => {}); } if (!has()) throw Object.assign(new Error('vendor outdated: ' + src), { code: 'vendorOld' }); return window[g]; }
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  // Android Chrome：Mobile Wallet Adapter（Wallet Standard 钱包；connect 与 signIn 合并为一次授权，authToken 持久化在 localStorage）
  let mwaP = null; const initMwa = () => mwaP ||= (async () => { if (!isAndroid() || !isSecureContext) return false; try { await Promise.race([cfgReady, new Promise(r => setTimeout(r, 5000))]); await loadJs('vendor/mwa.js'); return !!window.WTMWA?.init({ name: '光栖', uri: location.origin, icon: 'og-image.png' }, WTW.cfg.solChain || 'solana:devnet'); } catch { return false; } })();
  const MWA_NAME = /mobile wallet adapter/i;
  // WalletConnect（兜底）：按需加载库；需要服务端配置的项目 ID（WTW.cfg.wcProjectId）；连接二维码由站内弹窗显示（WTW.onWcUri）
  function wcAdapter() { let inner = null; const get = async () => { if (inner) return inner; await needVendor('vendor/walletconnect.js', 'WTWC', 'create'); const pid = WTW.cfg.wcProjectId; if (!pid) throw Object.assign(new Error('WalletConnect not configured'), { code: 'wcOff' });
      return inner = window.WTWC.create({ projectId: pid, metadata: { name: 'Guangqi', description: 'Guangqi World Tree', url: location.origin, icons: [location.origin + '/og-image.png'] }, onUri: u => WTW.onWcUri?.(u), b58, b58dec, mainnet: WTW.cfg.network === 'mainnet' }); };
    return { id: 'walletconnect', name: 'WalletConnect', canSignIn: false, connect: async sl => (await get()).connect(sl), signAndSend: async tx => (await get()).signAndSend(tx), signMessage: async m => (await get()).signMessage(m), onChange: cb => { get().then(i => i.onChange(cb)).catch(() => {}); }, disconnect: async () => { try { await inner?.disconnect(); } catch {} } }; }
  // Dynamic（邮箱 OTP / Google → 非托管 Solana 嵌入式钱包）：按需加载 vendor/dynamic.js；需要服务端公开配置的 Environment ID（WTW.cfg.dynamicEnvId）
  function dynAdapter() { let inner = null; const get = async () => { if (inner) return inner; const id = WTW.cfg.dynamicEnvId; if (!id) throw Object.assign(new Error('Dynamic not configured'), { code: 'dynOff' });
      await needVendor('vendor/dynamic.js', 'WTDYN', 'adapter'); window.WTDYN.envId = id; await window.WTDYN.init(id); return inner = window.WTDYN.adapter(); };
    return { id: 'dynamic', name: 'Dynamic', canSignIn: false, connect: async sl => (await get()).connect(sl), signAndSend: async tx => (await get()).signAndSend(tx), signMessage: async m => (await get()).signMessage(m), onChange: cb => { get().then(i => i.onChange(cb)).catch(() => {}); }, disconnect: async () => { try { await (await get()).disconnect(); } catch {} } }; }
  function solWallets() { // 返回四个固定钱包 + 其余 Wallet Standard 钱包；installed 表示可直接连接
    const out = [], used = new Set();
    for (const d of SOL) { const sw = [...std.values()].find(w => w.name.toLowerCase().includes(d.id === 'okx' ? 'okx' : d.id)); const p = d.inj();
      if (sw) used.add(sw.name); out.push({ ...d, installed: !!(sw || p), adapter: () => sw ? stdAdapter(sw, d.id) : injAdapter(p, d) }); }
    const mw = [...std.values()].find(w => MWA_NAME.test(w.name)); if (mw) { used.add(mw.name); out.unshift({ id: 'mwa', name: mw.name, icon: mw.icon, installed: true, mwa: true, adapter: () => stdAdapter(mw, 'mwa') }); } // Android + MWA 可用：排第一并优先连接
    for (const w of std.values()) if (!used.has(w.name)) out.push({ id: 'std:' + w.name, name: w.name, icon: w.icon, installed: true, adapter: () => stdAdapter(w, 'std:' + w.name) });
    out.push({ id: 'dynamic', name: 'Dynamic', installed: true, dyn: true, adapter: dynAdapter }); // 邮箱 / Google 登录
    out.push({ id: 'walletconnect', name: 'WalletConnect', installed: true, wc: true, adapter: wcAdapter }); // 兜底项
    return out; }
  // 钱包弹窗显示开关：隐藏的只是入口（代码与已有会话保留）。恢复：evmTab: true / hideSol: []；也可在页面里预先设置 window.WT_WALLET_UI 覆盖
  const ui = { evmTab: false, email: false, hideSol: ['solflare', 'backpack', 'okx'], ...(window.WT_WALLET_UI || {}) };
  const RANK = { phantom: 0, mwa: 1, dynamic: 2, walletconnect: 4 }; // 其余检测到的 Wallet Standard 钱包排在 WalletConnect 之前
  const solList = () => solWallets().filter(w => (ui.email || !w.dyn) && !ui.hideSol.includes(w.id) && !ui.hideSol.some(h => w.id.startsWith('std:') && w.name.toLowerCase().includes(h))).sort((a, b) => (RANK[a.id] ?? 3) - (RANK[b.id] ?? 3));
  // ---- EVM：EIP-6963 发现 + 注入式回退 ----
  const evm = new Map();
  addEventListener('eip6963:announceProvider', e => { const d = e.detail; if (d?.info?.rdns && d.provider) evm.set(d.info.rdns, d); });
  const ask = () => { try { dispatchEvent(new Event('eip6963:requestProvider')); } catch {} }; ask();
  const EVM = [
    { id: 'metamask', name: 'MetaMask', rdns: 'io.metamask', inj: () => window.ethereum?.isMetaMask && !window.ethereum.isOkxWallet && window.ethereum, deep: () => `https://metamask.app.link/dapp/${here().replace(/^https?:\/\//, '')}`, site: 'https://metamask.io/' },
    { id: 'okx', name: 'OKX Wallet', rdns: 'com.okex.wallet', inj: () => window.okxwallet?.request && window.okxwallet, deep: () => `okx://wallet/dapp/url?dappUrl=${enc(here())}`, site: 'https://www.okx.com/web3' },
    { id: 'coinbase', name: 'Coinbase Wallet', rdns: 'com.coinbase.wallet', inj: () => window.coinbaseWalletExtension || (window.ethereum?.isCoinbaseWallet && window.ethereum), deep: () => `https://go.cb-w.com/dapp?cb_url=${enc(here())}`, site: 'https://www.coinbase.com/wallet' },
    { id: 'trust', name: 'Trust Wallet', rdns: 'com.trustwallet.app', inj: () => window.trustwallet?.request && window.trustwallet || (window.ethereum?.isTrust && window.ethereum), deep: () => `https://link.trustwallet.com/open_url?coin_id=60&url=${enc(here())}`, site: 'https://trustwallet.com/' },
    { id: 'bitget', name: 'Bitget Wallet', rdns: 'com.bitget.web3', inj: () => window.bitkeep?.ethereum?.request && window.bitkeep.ethereum, deep: () => `https://bkcode.vip?action=dapp&url=${enc(here())}`, site: 'https://web3.bitget.com/' }];
  // EVM 版 WalletConnect / Dynamic：都包装成 EIP-1193 provider（按需加载 vendor），复用现有 personal_sign 登录与 eth_sendTransaction 支付
  const evmRpc = id => WTW.cfg.evmRpc?.(id) || (+id === 1 ? 'https://ethereum-rpc.publicnode.com' : '');
  let wcEvm = null; const wcEvmProvider = () => wcEvm ||= (() => { let inner = null; const get = async () => { if (inner) return inner; const pid = WTW.cfg.wcProjectId; if (!pid) throw Object.assign(new Error('WalletConnect not configured'), { code: 'wcOff' }); await needVendor('vendor/walletconnect.js', 'WTWC', 'createEvm');
      return inner = window.WTWC.createEvm({ projectId: pid, metadata: { name: 'Guangqi', description: 'Guangqi World Tree', url: location.origin, icons: [location.origin + '/og-image.png'] }, onUri: u => WTW.onWcUri?.(u), chains: [1, ...(WTW.cfg.evmChainIds?.() || [11155111, 84532, 421614, 97]).filter(c => +c !== 1)], rpc: evmRpc }); }, Lq = [];
    return { isWalletConnect: true, request: async a => (await get()).request(a), on: (e, f) => { if (inner) inner.on(e, f); else Lq.push([e, f]); get().then(i => { while (Lq.length) i.on(...Lq.shift()); }).catch(() => {}); }, removeListener: (e, f) => inner?.removeListener(e, f), disconnect: async () => inner?.disconnect() }; })();
  let dynEvm = null; const dynEvmProvider = () => dynEvm ||= (() => { let inner = null; const get = async () => { if (inner) return inner; const id = WTW.cfg.dynamicEnvId; if (!id) throw Object.assign(new Error('Dynamic not configured'), { code: 'dynOff' }); await needVendor('vendor/dynamic.js', 'WTDYN', 'evmProvider'); window.WTDYN.envId = id; await window.WTDYN.init(id); return inner = window.WTDYN.evmProvider(evmRpc); };
    return { isDynamic: true, request: async a => (await get()).request(a), on: (e, f) => { get().then(i => i.on(e, f)).catch(() => {}); }, removeListener: (e, f) => inner?.removeListener(e, f) }; })();
  function evmWallets() { ask(); const out = [], used = new Set();
    for (const d of EVM) { const a = evm.get(d.rdns); if (a) used.add(d.rdns); const p = a?.provider || d.inj(); out.push({ ...d, icon: a?.info.icon, installed: !!p, provider: p }); }
    for (const [r, a] of evm) if (!used.has(r)) out.push({ id: r, name: a.info.name, icon: a.info.icon, installed: true, provider: a.provider });
    if (!out.some(w => w.installed) && window.ethereum?.request) out.push({ id: 'injected', name: 'Browser wallet', installed: true, provider: window.ethereum }); // 通用注入钱包
    out.push({ id: 'dynamic', name: 'Dynamic', installed: true, dyn: true, get provider() { return dynEvmProvider(); } }); // 邮箱 / Google 登录（EVM 嵌入式钱包）
    out.push({ id: 'walletconnect', name: 'WalletConnect', installed: true, wc: true, get provider() { return wcEvmProvider(); } }); // 二维码 / 唤起手机钱包（eip155）
    return out; }
  const mobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const noProvider = kind => mobile() && !(kind === 'evm' ? evmWallets() : solWallets()).some(w => w.installed && !w.mwa && !w.wc && !w.dyn); // 手机浏览器没有注入任何钱包（MWA / WalletConnect 不算注入）
  // ---- EVM 工具 ----
  const hexOf = s => '0x' + [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');
  const toWei = s => { const m = String(s).trim().match(/^(\d*)(?:\.(\d{0,18}))?\d*$/); if (!m) throw new Error('amount'); return BigInt(m[1] || '0') * 10n ** 18n + BigInt((m[2] || '').padEnd(18, '0') || '0'); };
  async function switchChain(p, id, c) { const hx = '0x' + (+id).toString(16);
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hx }] }); }
    catch (e) { if (e?.code !== 4902 && !/unrecognized|not added|4902/i.test(e?.message || '')) throw e;
      if (p.isWalletConnect) throw Object.assign(new Error('chain not approved by wallet'), { code: 'wcChain' }); // WalletConnect 会话里钱包未批准该链（如只批准主网）：提示在钱包里切换网络或换钱包
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hx, chainName: c.name, nativeCurrency: { name: c.sym, symbol: c.sym, decimals: 18 }, rpcUrls: [c.rpc], blockExplorerUrls: [c.exp] }] }); } }
  async function waitReceipt(p, h, ms = 180000) { const t0 = Date.now(); // 仅在发出自己的交易后等待确认（非数据轮询）
    while (Date.now() - t0 < ms) { const r = await p.request({ method: 'eth_getTransactionReceipt', params: [h] }).catch(() => null); if (r) { if (r.status !== '0x1') throw new Error('tx reverted'); return r; } await new Promise(r => setTimeout(r, 2500)); }
    throw new Error('timeout'); }
  const LOGIN_CHAINS = [56, 97, 8453, 84532, 1, 11155111, 42161, 421614, 130, 1301];
  async function chainOf(p) { return parseInt(await p.request({ method: 'eth_chainId' }), 16); }
  async function readyChain(p, want, cfg) { // 签名前确定钱包当前网络：不受支持则切换到所选网络，切换后重新读取；消息里的 Chain ID 必须与之相同
    let c = await chainOf(p); if (LOGIN_CHAINS.includes(c) && (!want || c === +want)) return c;
    if (want) { try { await switchChain(p, want, cfg); } catch (e) { if (e?.code === 4001) throw e; } c = await chainOf(p); }
    if (!LOGIN_CHAINS.includes(c)) throw Object.assign(new Error('unsupported chain ' + c), { code: 'chainUnsupported' }); return c; }
  const evmList = () => evmWallets().filter(w => ui.email || !w.dyn);
  window.WTW = { cfg: {}, cfgDone: () => cfgDone(), ui, solList, evmList, vsrc, needVendor, initMwa, isAndroid, noProvider, b58dec, LOGIN_CHAINS, chainOf, readyChain, solWallets, evmWallets, mobile, b58, hexOf, toWei, switchChain, waitReceipt };
})();

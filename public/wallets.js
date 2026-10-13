// 多链钱包：Solana（Wallet Standard + 注入式：Phantom / Solflare / Backpack / OKX）与 EVM（EIP-6963 + 注入式：MetaMask / OKX / Coinbase）
// 非托管：只请求连接、签名消息和发送交易；私钥永远留在钱包里。移动端未检测到钱包时用深链接在钱包内置浏览器中打开本站。
(function () {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = u => { let n = 0n; for (const x of u) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const x of u) { if (x) break; s = '1' + s; } return s; };
  const toU8 = x => x instanceof Uint8Array ? x : x?.signature ? toU8(x.signature) : Array.isArray(x) ? Uint8Array.from(x) : new Uint8Array(x);
  const here = () => location.href, enc = encodeURIComponent;
  // ---- Solana：Wallet Standard 发现 ----
  const std = new Map();
  const reg = (...ws) => { for (const w of ws) if (w?.features?.['standard:connect'] && (w.features['solana:signAndSendTransaction'] || w.features['solana:signTransaction']) && (w.chains || []).some(c => c.startsWith('solana:'))) std.set(w.name, w); return () => {}; };
  try { addEventListener('wallet-standard:register-wallet', e => { try { e.detail({ register: reg }); } catch {} });
    dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: reg } })); } catch {}
  const SOL = [ // 固定展示的四个钱包：检测名称 / 注入对象 / 移动端深链接
    { id: 'phantom', name: 'Phantom', inj: () => window.phantom?.solana?.isPhantom && window.phantom.solana, deep: () => `https://phantom.app/ul/browse/${enc(here())}?ref=${enc(location.origin)}`, site: 'https://phantom.app/' },
    { id: 'solflare', name: 'Solflare', inj: () => window.solflare?.isSolflare && window.solflare, deep: () => `https://solflare.com/ul/v1/browse/${enc(here())}?ref=${enc(location.origin)}`, site: 'https://solflare.com/' },
    { id: 'backpack', name: 'Backpack', inj: () => window.backpack?.isBackpack && window.backpack, deep: () => `https://backpack.app/ul/v1/browse/${enc(here())}?ref=${enc(location.origin)}`, site: 'https://backpack.app/' },
    { id: 'okx', name: 'OKX Wallet', inj: () => window.okxwallet?.solana, deep: () => `okx://wallet/dapp/url?dappUrl=${enc(here())}`, site: 'https://www.okx.com/web3' }];
  function stdAdapter(w, id) { let acct = null; const F = w.features;
    return { id, name: w.name, icon: w.icon, std: true,
      async connect(silent) { const r = await F['standard:connect'].connect(silent ? { silent: true } : undefined); acct = (r?.accounts || w.accounts)[0]; if (!acct) throw new Error('no account'); return acct.address; },
      async signAndSend(tx) { const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        if (F['solana:signAndSendTransaction']) { const [o] = await F['solana:signAndSendTransaction'].signAndSendTransaction({ account: acct, transaction: bytes, chain: 'solana:devnet' }); return b58(toU8(o.signature)); }
        const [o] = await F['solana:signTransaction'].signTransaction({ account: acct, transaction: bytes, chain: 'solana:devnet' }); return { raw: toU8(o.signedTransaction) }; },
      async signMessage(m) { if (!F['solana:signMessage']) throw new Error('signMessage unsupported'); const [o] = await F['solana:signMessage'].signMessage({ account: acct, message: m }); return toU8(o.signature); },
      async disconnect() { try { await F['standard:disconnect']?.disconnect(); } catch {} } }; }
  function injAdapter(p, d) { let pk = null;
    return { id: d.id, name: d.name,
      async connect(silent) { const r = await p.connect(silent ? { onlyIfTrusted: true } : undefined); pk = (r?.publicKey || p.publicKey)?.toString(); if (!pk) throw new Error('no account'); return pk; },
      async signAndSend(tx) { const r = await p.signAndSendTransaction(tx); return typeof r === 'string' ? r : r.signature || r.publicKey && r; },
      async signMessage(m) { return toU8(await p.signMessage(m, 'utf8')); },
      async disconnect() { try { await p.disconnect?.(); } catch {} } }; }
  function solWallets() { // 返回四个固定钱包 + 其余 Wallet Standard 钱包；installed 表示可直接连接
    const out = [], used = new Set();
    for (const d of SOL) { const sw = [...std.values()].find(w => w.name.toLowerCase().includes(d.id === 'okx' ? 'okx' : d.id)); const p = d.inj();
      if (sw) used.add(sw.name); out.push({ ...d, installed: !!(sw || p), adapter: () => sw ? stdAdapter(sw, d.id) : injAdapter(p, d) }); }
    for (const w of std.values()) if (!used.has(w.name)) out.push({ id: 'std:' + w.name, name: w.name, icon: w.icon, installed: true, adapter: () => stdAdapter(w, 'std:' + w.name) });
    return out; }
  // ---- EVM：EIP-6963 发现 + 注入式回退 ----
  const evm = new Map();
  addEventListener('eip6963:announceProvider', e => { const d = e.detail; if (d?.info?.rdns && d.provider) evm.set(d.info.rdns, d); });
  const ask = () => { try { dispatchEvent(new Event('eip6963:requestProvider')); } catch {} }; ask();
  const EVM = [
    { id: 'metamask', name: 'MetaMask', rdns: 'io.metamask', inj: () => window.ethereum?.isMetaMask && !window.ethereum.isOkxWallet && window.ethereum, deep: () => `https://metamask.app.link/dapp/${here().replace(/^https?:\/\//, '')}`, site: 'https://metamask.io/' },
    { id: 'okx', name: 'OKX Wallet', rdns: 'com.okex.wallet', inj: () => window.okxwallet?.request && window.okxwallet, deep: () => `okx://wallet/dapp/url?dappUrl=${enc(here())}`, site: 'https://www.okx.com/web3' },
    { id: 'coinbase', name: 'Coinbase Wallet', rdns: 'com.coinbase.wallet', inj: () => window.coinbaseWalletExtension || (window.ethereum?.isCoinbaseWallet && window.ethereum), deep: () => `https://go.cb-w.com/dapp?cb_url=${enc(here())}`, site: 'https://www.coinbase.com/wallet' }];
  function evmWallets() { ask(); const out = [], used = new Set();
    for (const d of EVM) { const a = evm.get(d.rdns); if (a) used.add(d.rdns); const p = a?.provider || d.inj(); out.push({ ...d, icon: a?.info.icon, installed: !!p, provider: p }); }
    for (const [r, a] of evm) if (!used.has(r)) out.push({ id: r, name: a.info.name, icon: a.info.icon, installed: true, provider: a.provider });
    if (!out.some(w => w.installed) && window.ethereum?.request) out.push({ id: 'injected', name: 'Browser wallet', installed: true, provider: window.ethereum }); // 通用注入钱包
    return out; }
  const mobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  // ---- EVM 工具 ----
  const hexOf = s => '0x' + [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('');
  const toWei = s => { const m = String(s).trim().match(/^(\d*)(?:\.(\d{0,18}))?\d*$/); if (!m) throw new Error('amount'); return BigInt(m[1] || '0') * 10n ** 18n + BigInt((m[2] || '').padEnd(18, '0') || '0'); };
  async function switchChain(p, id, c) { const hx = '0x' + (+id).toString(16);
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hx }] }); }
    catch (e) { if (e?.code !== 4902 && !/unrecognized|not added|4902/i.test(e?.message || '')) throw e;
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hx, chainName: c.name, nativeCurrency: { name: c.sym, symbol: c.sym, decimals: 18 }, rpcUrls: [c.rpc], blockExplorerUrls: [c.exp] }] }); } }
  async function waitReceipt(p, h, ms = 180000) { const t0 = Date.now(); // 仅在发出自己的交易后等待确认（非数据轮询）
    while (Date.now() - t0 < ms) { const r = await p.request({ method: 'eth_getTransactionReceipt', params: [h] }).catch(() => null); if (r) { if (r.status !== '0x1') throw new Error('tx reverted'); return r; } await new Promise(r => setTimeout(r, 2500)); }
    throw new Error('timeout'); }
  window.WTW = { solWallets, evmWallets, mobile, b58, hexOf, toWei, switchChain, waitReceipt };
})();

// WalletConnect（兜底）：Solana 命名空间 + EVM（eip155，WTWC.createEvm 返回 EIP-1193 provider），经 display_uri 事件交给站内二维码弹窗（不使用官方弹窗）。需要 Reown / WalletConnect 项目 ID（服务端 WC_PROJECT_ID，公开标识，不是密钥）。
import UniversalProvider from '@walletconnect/universal-provider';
const CH_DEV = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', CH_MAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', METHODS = ['solana_signMessage', 'solana_signTransaction'];
const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); }, unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
window.WTWC = { create({ projectId, metadata, onUri, b58, b58dec, mainnet }) { let prov = null, pk = null; const CH = mainnet ? CH_MAIN : CH_DEV;
  const init = async () => prov ||= await UniversalProvider.init({ projectId, metadata });
  const addr = s => s.namespaces.solana.accounts[0].split(':')[2];
  return { id: 'walletconnect', name: 'WalletConnect', canSignIn: false,
    async connect(silent) { const p = await init(); if (p.session?.namespaces?.solana) return pk = addr(p.session); if (silent) throw new Error('no session');
      p.on('display_uri', onUri); const s = await p.connect({ namespaces: { solana: { methods: METHODS, chains: [CH], events: [] } } }); return pk = addr(s); },
    async signMessage(m) { const r = await prov.request({ method: 'solana_signMessage', params: { message: b58(m), pubkey: pk } }, CH); return b58dec(r.signature); },
    async signAndSend(tx) { const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }); const r = await prov.request({ method: 'solana_signTransaction', params: { transaction: b64(bytes), feePayer: pk, recentBlockhash: tx.recentBlockhash } }, CH);
      if (r.transaction) return { raw: unb64(r.transaction) }; tx.addSignature(tx.feePayer, b58dec(r.signature)); return { raw: tx.serialize() }; },
    onChange(cb) { try { prov?.on('session_delete', () => cb(null)); } catch {} },
    async disconnect() { try { await prov?.disconnect(); } catch {} } }; } };

// ---- EVM（eip155）：包装成 EIP-1193 provider，交给现有 EVM 登录 / 支付流程（personal_sign、eth_sendTransaction、wallet_switchEthereumChain）----
// 单独的存储前缀，避免与 Solana 会话互相覆盖。读类方法（回执、余额等）直接走站点配置的公共 RPC，不经过钱包。
const EVM_METHODS = ['personal_sign', 'eth_sendTransaction', 'wallet_switchEthereumChain', 'wallet_addEthereumChain','eth_signTypedData_v4'];
window.WTWC.createEvm = ({ projectId, metadata, onUri, chains, rpc }) => { let prov = null, cur = null; const L = new Set();
  const init = async () => prov ||= await UniversalProvider.init({ projectId, metadata, customStoragePrefix: 'wt-evm' });
  const ns = () => prov?.session?.namespaces?.eip155, accts = () => (ns()?.accounts || []), addr = () => accts()[0]?.split(':')[2] || null;
  const okChain = id => accts().some(a => a.split(':')[1] === String(id)) || (ns()?.chains || []).includes('eip155:' + id);
  const emit = (ev, v) => { for (const [e, f] of L) if (e === ev) try { f(v); } catch {} };
  const rerr = (code, message) => Object.assign(new Error(message), { code });
  const read = async (method, params) => { const u = rpc(cur); if (!u) throw rerr(4200, 'no rpc'); const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) }).then(x => x.json()); if (r.error) throw rerr(r.error.code, r.error.message); return r.result; };
  async function connect() { const p = await init(); if (ns()) return addr(); p.on('display_uri', onUri);
    const rpcMap = Object.fromEntries(chains.map(c => [c, rpc(c)]).filter(x => x[1]));
    // t309：eip155:1 作为 required（imKey 等钱包在没有 required 链时会拒绝），Base / Arbitrum / BSC 为 optional；方法最小化。
    // 注意：打包后的 @walletconnect 2.26.0 会把 requiredNamespaces 清空并并入 optional——public/vendor/walletconnect.js 已打补丁（搜索 wt-patch:keep-required），重新打包时需同样处理。
    const ev = ['chainChanged', 'accountsChanged'];
    await p.connect({ namespaces: { eip155: { methods: ['personal_sign', 'eth_sendTransaction'], chains: ['eip155:1'], events: ev, rpcMap } },
      optionalNamespaces: { eip155: { methods: ['personal_sign', 'eth_sendTransaction', 'eth_chainId', 'wallet_switchEthereumChain'], chains: chains.filter(c => +c !== 1).map(c => 'eip155:' + c), events: ev, rpcMap } } });
    try { p.on('session_delete', () => emit('accountsChanged', [])); p.on('session_event', e => { const ev = e?.params?.event; if (ev?.name === 'chainChanged') { cur = parseInt(String(ev.data).replace(/^eip155:/, ''), String(ev.data).startsWith('0x') ? 16 : 10); emit('chainChanged', '0x' + cur.toString(16)); } else if (ev?.name === 'accountsChanged') emit('accountsChanged', (ev.data || []).map(a => String(a).split(':').pop())); }); } catch {}
    return addr(); }
  const provider = { isWalletConnect: true,
    async request({ method, params }) {
      if (method === 'eth_requestAccounts') { const a = await connect(); if (!a) throw rerr(4001, 'rejected'); cur ||= +accts()[0].split(':')[1]; return [a]; }
      if (method === 'eth_accounts') { const p = await init(); const a = ns() ? addr() : null; if (a) cur ||= +accts()[0].split(':')[1]; return a ? [a] : []; }
      if (!ns()) throw rerr(4100, 'not connected');
      if (method === 'eth_chainId') return '0x' + (cur ||= +accts()[0].split(':')[1]).toString(16);
      if (method === 'wallet_requestPermissions' || method === 'wallet_revokePermissions') { if (method === 'wallet_revokePermissions') { try { await prov.disconnect(); } catch {} } throw rerr(4200, 'unsupported'); }
      if (method === 'wallet_switchEthereumChain') { const id = parseInt(params[0].chainId, 16); if (okChain(id)) { try { await prov.request({ method, params }, 'eip155:' + (cur || id)); } catch (e) { if (e?.code === 4001) throw e; } cur = id; emit('chainChanged', params[0].chainId); return null; } throw rerr(4902, 'chain not approved in session'); }
      if (EVM_METHODS.includes(method) || /^eth_sign/.test(method)) return prov.request({ method, params }, 'eip155:' + cur);
      return read(method, params); },
    on(ev, f) { L.add([ev, f]); }, removeListener(ev, f) { for (const x of L) if (x[0] === ev && x[1] === f) L.delete(x); },
    async disconnect() { try { await prov?.disconnect(); } catch {} } };
  return provider; };

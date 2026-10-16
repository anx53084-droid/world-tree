// WalletConnect（兜底）：Solana 命名空间，经 display_uri 事件交给站内二维码弹窗（不使用官方弹窗）。需要 Reown / WalletConnect 项目 ID（服务端 WC_PROJECT_ID，公开标识，不是密钥）。
import UniversalProvider from '@walletconnect/universal-provider';
const CH = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', METHODS = ['solana_signMessage', 'solana_signTransaction'];
const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); }, unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
window.WTWC = { create({ projectId, metadata, onUri, b58, b58dec }) { let prov = null, pk = null;
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

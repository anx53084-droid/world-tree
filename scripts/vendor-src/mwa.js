// Solana Mobile Wallet Adapter（Android Chrome）：注册为 Wallet Standard 钱包，connect 与 signIn 合并为一次授权；authToken 持久化在 localStorage（wt_mwa_auth）供复用。
import { registerMwa } from '@solana-mobile/wallet-standard-mobile';
const KEY = 'wt_mwa_auth', b58 = (() => { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; return s => { let n = 0n; for (const c of s) n = n * 58n + BigInt(A.indexOf(c)); const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== '1') break; out.unshift(0); } return new Uint8Array(out); }; })();
let skip = false; // 用户主动「连接并签名登录」时必须拿到全新的 sign-in 结果（缓存里的旧签名 nonce 已失效）；authToken 仍会写回缓存供后续复用
const cache = {
  async get() { if (skip) { skip = false; return undefined; } try { const p = JSON.parse(localStorage.getItem(KEY)); if (p && p.accounts) return { ...p, accounts: p.accounts.map(a => ({ ...a, publicKey: 'publicKey' in a ? new Uint8Array(Object.values(a.publicKey)) : b58(a.address) })) }; return p || undefined; } catch { return undefined; } },
  async set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  async clear() { try { localStorage.removeItem(KEY); } catch {} } };
window.WTMWA = { fresh() { skip = true; }, init(identity) { try { registerMwa({ appIdentity: identity, authorizationCache: cache, chains: ['solana:devnet'], onWalletNotFound: async () => { window.dispatchEvent(new CustomEvent('wt:mwa-notfound')); } }); return true; } catch (e) { console.warn('mwa', e); return false; } }, clear: () => cache.clear() };

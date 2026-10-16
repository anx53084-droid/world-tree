// Dynamic（app.dynamic.xyz）无界面 JS SDK：邮箱 OTP / Google 登录 → 自动创建非托管 Solana 嵌入式钱包（WaaS，私钥分片由用户持有，站点和平台都拿不到私钥）。
// 只注册 WaaS Solana 扩展（不做外部钱包发现，外部钱包仍由 wallets.js 处理）。Environment ID 来自 /api/config 的 DYNAMIC_ENV_ID（公开标识）。
import { createDynamicClient, initializeClient, sendEmailOTP, verifyOTP, signInWithSocialRedirect, detectSocialRedirectUrl, completeSocialRedirect, getWalletAccounts, signMessage, onEvent, logout } from '@dynamic-labs-sdk/client';
import { getChainsMissingWaasWalletAccounts, createWaasWalletAccounts } from '@dynamic-labs-sdk/client/waas';
import { addWaasSolanaExtension } from '@dynamic-labs-sdk/solana/waas';
import { signTransaction } from '@dynamic-labs-sdk/solana';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58dec = s => { let n = 0n; for (const c of s) { const i = A.indexOf(c); if (i < 0) throw new Error('b58'); n = n * 58n + BigInt(i); } const o = []; while (n > 0n) { o.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== '1') break; o.unshift(0); } return Uint8Array.from(o); };
const sigBytes = s => { if (s instanceof Uint8Array) return s; if (/^(0x)?[0-9a-f]{128}$/i.test(s)) { const h = s.replace(/^0x/, ''); return Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16))); }
  try { const b = b58dec(s); if (b.length === 64) return b; } catch {} const b = Uint8Array.from(atob(s), c => c.charCodeAt(0)); if (b.length === 64) return b; throw new Error('signature format'); };
let client = null;
const sol = () => getWalletAccounts().filter(a => a.chain === 'SOL');
async function init(envId) { if (client) return client; client = createDynamicClient({ autoInitialize: false, environmentId: envId, metadata: { name: '光栖', universalLink: location.origin } }); addWaasSolanaExtension(); await initializeClient(); return client; }
async function ensureWallet() { // 登录后创建嵌入式钱包（不是自动的）；无条件调用
  await createWaasWalletAccounts({ chains: getChainsMissingWaasWalletAccounts() }); const a = sol()[0]; if (!a) throw Object.assign(new Error('no solana wallet'), { code: 'dynNoWallet' }); return a.address; }
window.WTDYN = { init, ensureWallet,
  sendEmail: async email => sendEmailOTP({ email }), verify: async (otpVerification, code) => { await verifyOTP({ otpVerification, verificationToken: code }); return ensureWallet(); },
  google: redirectUrl => signInWithSocialRedirect({ provider: 'google', redirectUrl }),
  async finishRedirect() { const url = new URL(location.href); if (!(await detectSocialRedirectUrl({ url }))) return null; await completeSocialRedirect({ url }); return ensureWallet(); },
  address: () => sol()[0]?.address || null,
  adapter() { return { id: 'dynamic', name: 'Dynamic', canSignIn: false,
    async connect(silent) { await init(window.WTDYN.envId); let a = sol()[0]; if (!a && !silent) { await ensureWallet(); a = sol()[0]; } if (!a) throw new Error('no session'); return a.address; },
    async signMessage(m) { const a = sol()[0]; if (!a) throw new Error('no session'); const { signature } = await signMessage({ walletAccount: a, message: new TextDecoder().decode(m) }); return sigBytes(signature); },
    async signAndSend(tx) { const a = sol()[0]; if (!a) throw new Error('no session'); const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }); let t; try { t = Transaction.from(bytes); } catch { t = VersionedTransaction.deserialize(bytes); }
      const { signedTransaction } = await signTransaction({ transaction: t, walletAccount: a }); return { raw: signedTransaction.serialize() }; }, // 只签名；由用户自己的会话把交易发到链上，网络费由该钱包自己支付
    onChange(cb) { try { onEvent({ event: 'walletAccountsChanged', listener: () => cb(sol()[0]?.address || null) }); } catch {} },
    async disconnect() { try { await logout(); } catch {} } }; } };

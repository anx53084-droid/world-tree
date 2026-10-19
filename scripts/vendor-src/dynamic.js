// Dynamic（app.dynamic.xyz）无界面 JS SDK：邮箱 OTP / Google 登录 → 自动创建非托管 Solana 嵌入式钱包（WaaS，私钥分片由用户持有，站点和平台都拿不到私钥）。
// 只注册 WaaS Solana 扩展（不做外部钱包发现，外部钱包仍由 wallets.js 处理）。Environment ID 来自 /api/config 的 DYNAMIC_ENV_ID（公开标识）。
import { createDynamicClient, initializeClient, sendEmailOTP, verifyOTP, signInWithSocialRedirect, detectSocialRedirectUrl, completeSocialRedirect, getWalletAccounts, signMessage, onEvent, logout, getActiveNetworkId, switchActiveNetwork, getNetworksData } from '@dynamic-labs-sdk/client';
import { addWaasEvmExtension } from '@dynamic-labs-sdk/evm/waas';
import { createWalletClientForWalletAccount } from '@dynamic-labs-sdk/evm/viem';
import { getChainsMissingWaasWalletAccounts, createWaasWalletAccounts } from '@dynamic-labs-sdk/client/waas';
import { addWaasSolanaExtension } from '@dynamic-labs-sdk/solana/waas';
import { signTransaction } from '@dynamic-labs-sdk/solana';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58dec = s => { let n = 0n; for (const c of s) { const i = A.indexOf(c); if (i < 0) throw new Error('b58'); n = n * 58n + BigInt(i); } const o = []; while (n > 0n) { o.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== '1') break; o.unshift(0); } return Uint8Array.from(o); };
const sigBytes = s => { if (s instanceof Uint8Array) return s; if (/^(0x)?[0-9a-f]{128}$/i.test(s)) { const h = s.replace(/^0x/, ''); return Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16))); }
  try { const b = b58dec(s); if (b.length === 64) return b; } catch {} const b = Uint8Array.from(atob(s), c => c.charCodeAt(0)); if (b.length === 64) return b; throw new Error('signature format'); };
let client = null;
const sol = () => getWalletAccounts().filter(a => a.chain === 'SOL'), evmA = () => getWalletAccounts().filter(a => a.chain === 'EVM');
async function init(envId) { if (client) return client; client = createDynamicClient({ autoInitialize: false, environmentId: envId, metadata: { name: '光栖', universalLink: location.origin } }); addWaasSolanaExtension(); addWaasEvmExtension(); await initializeClient(); return client; }
async function ensureWallet(chain = 'SOL') { // 登录后创建嵌入式钱包（不是自动的）；无条件调用。同一登录在 SOL / EVM 下各有自己的地址
  try { await createWaasWalletAccounts({ chains: getChainsMissingWaasWalletAccounts() }); } catch (e) { if (!(chain === 'SOL' ? sol() : evmA())[0]) throw e; }
  const a = (chain === 'SOL' ? sol() : evmA())[0]; if (!a) throw Object.assign(new Error('no ' + chain + ' wallet'), { code: chain === 'SOL' ? 'dynNoWallet' : 'dynNoEvm' }); return a.address; }
const hexToStr = h => { try { const b = h.replace(/^0x/, '').match(/../g) || []; return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(b.map(x => parseInt(x, 16)))); } catch { return h; } };
// EVM 嵌入式钱包 → EIP-1193 provider（交给现有 EVM 登录 / 支付流程）；网络必须是 Dynamic 后台已启用的 EVM 网络
function evmProvider(rpc) { const L = new Set(), emit = (e, v) => { for (const [k, f] of L) if (k === e) try { f(v); } catch {} }, err = (code, m) => Object.assign(new Error(m), { code });
  const acct = () => evmA()[0], cid = async () => { const a = acct(); const { networkId } = await getActiveNetworkId({ walletAccount: a }); return +networkId; };
  return { isDynamic: true,
    async request({ method, params }) { const a = acct();
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return a ? [a.address] : method === 'eth_accounts' ? [] : (() => { throw err(4001, 'no session'); })();
      if (!a) throw err(4100, 'not connected');
      if (method === 'eth_chainId') return '0x' + (await cid()).toString(16);
      if (method === 'wallet_requestPermissions') throw err(4200, 'unsupported'); if (method === 'wallet_revokePermissions') { try { await logout(); } catch {} return null; }
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { const id = String(parseInt(params[0].chainId, 16)); const nets = (getNetworksData?.() || []).flat().filter(n => n.chain === 'EVM').map(n => String(n.networkId));
        if (nets.length && !nets.includes(id)) throw err(4902, 'network not enabled in Dynamic'); try { await switchActiveNetwork({ walletAccount: a, networkId: id }); } catch (e) { throw err(4902, e?.message || 'switch failed'); } emit('chainChanged', '0x' + (+id).toString(16)); return null; }
      if (method === 'personal_sign') { const { signature } = await signMessage({ walletAccount: a, message: hexToStr(params[0]) }); return signature; }
      if (method === 'eth_sendTransaction') { const tx = params[0], wc = await createWalletClientForWalletAccount({ walletAccount: a }); return wc.sendTransaction({ account: wc.account, chain: wc.chain, to: tx.to, value: BigInt(tx.value || 0), data: tx.data }); } // 由用户自己的嵌入式钱包签名并发送，网络费由该钱包支付
      const u = rpc(await cid()); if (!u) throw err(4200, 'no rpc'); const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) }).then(x => x.json()); if (r.error) throw err(r.error.code, r.error.message); return r.result; },
    on(e, f) { L.add([e, f]); if (e === 'accountsChanged') try { onEvent({ event: 'walletAccountsChanged', listener: () => f(acct() ? [acct().address] : []) }); } catch {} }, removeListener(e, f) { for (const x of L) if (x[0] === e && x[1] === f) L.delete(x); } }; }
window.WTDYN = { init, ensureWallet, evmProvider, evmAddress: () => evmA()[0]?.address || null, evmEnabled: () => (getNetworksData?.() || []).flat().some(n => n.chain === 'EVM'), evmNetworks: () => (getNetworksData?.() || []).flat().filter(n => n.chain === 'EVM').map(n => +n.networkId),
  sendEmail: async email => sendEmailOTP({ email }), verify: async (otpVerification, code, chain) => { await verifyOTP({ otpVerification, verificationToken: code }); return ensureWallet(chain); },
  google: redirectUrl => signInWithSocialRedirect({ provider: 'google', redirectUrl }),
  async finishRedirect(chain) { const url = new URL(location.href); if (!(await detectSocialRedirectUrl({ url }))) return null; await completeSocialRedirect({ url }); return ensureWallet(chain); },
  address: () => sol()[0]?.address || null,
  adapter() { return { id: 'dynamic', name: 'Dynamic', canSignIn: false,
    async connect(silent) { await init(window.WTDYN.envId); let a = sol()[0]; if (!a && !silent) { await ensureWallet(); a = sol()[0]; } if (!a) throw new Error('no session'); return a.address; },
    async signMessage(m) { const a = sol()[0]; if (!a) throw new Error('no session'); const { signature } = await signMessage({ walletAccount: a, message: new TextDecoder().decode(m) }); return sigBytes(signature); },
    async signAndSend(tx) { const a = sol()[0]; if (!a) throw new Error('no session'); const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }); let t; try { t = Transaction.from(bytes); } catch { t = VersionedTransaction.deserialize(bytes); }
      const { signedTransaction } = await signTransaction({ transaction: t, walletAccount: a }); return { raw: signedTransaction.serialize() }; }, // 只签名；由用户自己的会话把交易发到链上，网络费由该钱包自己支付
    onChange(cb) { try { onEvent({ event: 'walletAccountsChanged', listener: () => cb(sol()[0]?.address || null) }); } catch {} },
    async disconnect() { try { await logout(); } catch {} } }; } };

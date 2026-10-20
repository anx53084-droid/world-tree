// 各链收款地址（单一配置源；仅公开地址，无密钥）。改地址只改这里（或用下面的环境变量追加“历史地址”）。
//   address ：当前收款地址（前端显示、交易构造、服务端校验都用它）
//   legacy  ：历史收款地址——过渡期内仍被服务端识别（验证已有记录 / 补单），但不再展示、不再作为收款目标
// 链 key 与 account.js 的 CHAINS 一致（eth / bsc / base / arb / uni 为 EVM；sol 为 Solana）。
// 旧的环境变量（RECEIVE_PUBKEY / TREASURY_PUBKEY / DEV_PUBKEY / EVM_PAY_*）不再决定当前地址，只会被当作额外的历史地址。
const { keccak_256 } = require('@noble/hashes/sha3');
const CONFIG = {
  // Solana：Squads v4 金库（vault 0）地址，不是多签账户本身（BcrXD8Xa…）。金库是 off-curve 的 PDA：
  // 向它转 SOL 是普通 System Program 转账，没问题；若将来收 SPL 代币，必须用 getAssociatedTokenAddressSync(mint, vault, true /* allowOwnerOffCurve */) 作为收款 ATA。
  sol: { address: 'FPKFevoHzjPZWjWaRxwFwfNXu2LBduoGspXZSCLU81yz', legacy: ['2Xjes9L3kePHUKyQaFfueHr933d6V71rPSSF3zZxL6pc'], note: 'Squads v4 vault 0 (PDA, off-curve)' },
  eth: { address: '0xbfa2C12D28838bEA6C92645c195fAa907182ECed', legacy: ['0x257ae349424c3047a3Acbe02351520d8e5Bd6458'], note: 'Safe 1.4.1 (2-of-3)' },
  bsc: { address: '0x71c04f3C4922d1A6FA2724428d4E2c51f5445837', legacy: ['0x03247ce2bf38bd5e570f13ef7020f4956e350797'], note: 'Safe L2 1.4.1 (2-of-3)' },
  // 以下链上尚未部署对应 Safe：钱打到未部署地址有风险，暂时保持原地址；部署 Safe 后把 address 改过去、旧地址放进 legacy 即可。
  base: { address: '0x257ae349424c3047a3Acbe02351520d8e5Bd6458', legacy: [], note: 'unchanged (no Safe deployed yet)' },
  arb: { address: '0x257ae349424c3047a3Acbe02351520d8e5Bd6458', legacy: [], note: 'unchanged (no Safe deployed yet)' },
  uni: { address: '0x4BF1746F3e83b1fb87c9058850B4442cC9AbD740', legacy: [], note: 'unchanged (no Safe deployed yet)' },
};
// 主网（NETWORK=mainnet）收款地址。sol / eth / bsc 是已在主网部署的 Squads / Safe 多签（与上面相同）。
// ⚠️ base / arb：Safe 尚未部署 → 留空 = 该链在主网不提供收款（前端不显示该链路由）。部署好 Safe 后把地址填到这里。
const CONFIG_MAINNET = {
  sol: { address: 'FPKFevoHzjPZWjWaRxwFwfNXu2LBduoGspXZSCLU81yz', legacy: [], note: 'Squads v4 vault 0 (mainnet)' },
  eth: { address: '0xbfa2C12D28838bEA6C92645c195fAa907182ECed', legacy: [], note: 'Safe 1.4.1 (2-of-3, mainnet)' },
  bsc: { address: '0x71c04f3C4922d1A6FA2724428d4E2c51f5445837', legacy: [], note: 'Safe L2 1.4.1 (2-of-3, BNB Chain)' },
  base: { address: '0x71c04f3C4922d1A6FA2724428d4E2c51f5445837', legacy: ['0x257ae349424c3047a3Acbe02351520d8e5Bd6458'], note: 'Safe L2 1.4.1 (2-of-3, Base)' },
  arb: { address: '0x71c04f3C4922d1A6FA2724428d4E2c51f5445837', legacy: ['0x257ae349424c3047a3Acbe02351520d8e5Bd6458'], note: 'Safe L2 1.4.1 (2-of-3, Arbitrum One)' },
};
const MAIN = require('./network').MAIN, ACTIVE = MAIN ? CONFIG_MAINNET : CONFIG;
const isEvm = a => /^0x[0-9a-fA-F]{40}$/.test(a || ''), B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function checksum(a) { const l = a.toLowerCase().slice(2), h = Buffer.from(keccak_256(Buffer.from(l, 'ascii'))).toString('hex'); return '0x' + [...l].map((c, i) => parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c).join(''); } // EIP-55
const envExtra = MAIN ? {} : { sol: [process.env.RECEIVE_PUBKEY, process.env.TREASURY_PUBKEY, process.env.DEV_PUBKEY], bsc: [process.env.EVM_PAY_BSC], base: [process.env.EVM_PAY_BASE], eth: [process.env.EVM_PAY_ETH], arb: [process.env.EVM_PAY_ARB], uni: [process.env.EVM_PAY_UNI] };
const out = { sol: null, evm: {}, legacy: { sol: [], evm: {} } };
for (const [k, v] of Object.entries(ACTIVE)) { if (k !== 'sol' && !v.address) continue; // 未配置的链：不收款
  const evm = k !== 'sol', ok = evm ? isEvm : a => B58.test(a || ''); if (!ok(v.address)) throw new Error('bad receive address for ' + k);
  const norm = a => evm ? a.toLowerCase() : a, cur = norm(v.address);
  const leg = [...new Set([...(v.legacy || []), ...(envExtra[k] || []).filter(Boolean)].filter(ok).map(norm))].filter(a => a !== cur);
  if (evm) { out.evm[k] = { address: checksum(v.address), lower: cur }; out.legacy.evm[k] = leg; } else { out.sol = { address: v.address }; out.legacy.sol = leg; }
}
// 校验：当前 / 历史地址判断（EVM 一律小写比较；Solana 区分大小写）
out.isSolRecv = a => !!a && (a === out.sol.address || out.legacy.sol.includes(a));
out.isEvmRecv = (key, a) => { a = String(a || '').toLowerCase(); return !!out.evm[key] && (a === out.evm[key].lower || (out.legacy.evm[key] || []).includes(a)); };
out.CONFIG = ACTIVE; out.CONFIG_TESTNET = CONFIG; out.CONFIG_MAINNET = CONFIG_MAINNET; out.checksum = checksum; out.isEvm = isEvm;
module.exports = out;

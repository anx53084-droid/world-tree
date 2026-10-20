// 网络开关：NETWORK=testnet（默认）| mainnet。所有链相关配置的单一来源（server / account / receive-config / persist 共用；前端经 /api/config 读取）。
// 回滚：删掉 NETWORK 或设为 testnet 即可；两套数据按网络分开存（testnet 用 data/，mainnet 用 data/mainnet/ 与 D1 的 "mainnet:" 前缀），互不覆盖。
const path = require('path'), E = process.env;
const NET = String(E.NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet', MAIN = NET === 'mainnet';
const SOL_PUBLIC_MAIN = 'https://api.mainnet-beta.solana.com';
const SOL_RPC = MAIN ? (E.SOLANA_RPC_MAINNET || SOL_PUBLIC_MAIN) : (E.SOLANA_RPC || E.RPC_URL || 'https://api.devnet.solana.com');
const EVM_CHAINS = MAIN ? {
  56: { key: 'bsc', name: 'BNB Smart Chain', sym: 'BNB', coin: 'binancecoin', rpc: 'https://bsc-dataseed.bnbchain.org', exp: 'https://bscscan.com' },
  8453: { key: 'base', name: 'Base', sym: 'ETH', coin: 'ethereum', rpc: 'https://mainnet.base.org', exp: 'https://basescan.org' },
  1: { key: 'eth', name: 'Ethereum', sym: 'ETH', coin: 'ethereum', rpc: 'https://ethereum-rpc.publicnode.com', exp: 'https://etherscan.io' },
  42161: { key: 'arb', name: 'Arbitrum One', sym: 'ETH', coin: 'ethereum', rpc: 'https://arb1.arbitrum.io/rpc', exp: 'https://arbiscan.io' } }
  : {
  97: { key: 'bsc', name: 'BNB Smart Chain Testnet', sym: 'tBNB', coin: 'binancecoin', rpc: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545', exp: 'https://testnet.bscscan.com' },
  84532: { key: 'base', name: 'Base Sepolia', sym: 'ETH', coin: 'ethereum', rpc: 'https://sepolia.base.org', exp: 'https://sepolia.basescan.org' },
  11155111: { key: 'eth', name: 'Sepolia', sym: 'ETH', coin: 'ethereum', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', exp: 'https://sepolia.etherscan.io' },
  421614: { key: 'arb', name: 'Arbitrum Sepolia', sym: 'ETH', coin: 'ethereum', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', exp: 'https://sepolia.arbiscan.io' },
  1301: { key: 'uni', name: 'Unichain Sepolia', sym: 'ETH', coin: 'ethereum', rpc: 'https://sepolia.unichain.org', exp: 'https://sepolia.uniscan.xyz' } };
module.exports = {
  NET, MAIN, SOL_RPC, SOL_RPC_PUBLIC: MAIN && !E.SOLANA_RPC_MAINNET, // 未配专用 RPC：公共主网 RPC，中继需限流
  SOL_CLUSTER: MAIN ? 'mainnet-beta' : 'devnet', SOL_CHAIN: MAIN ? 'solana:mainnet' : 'solana:devnet',
  SOL_RPC_BROWSER: MAIN ? (E.SOLANA_RPC_BROWSER_MAINNET || SOL_PUBLIC_MAIN) : 'https://api.devnet.solana.com', // 浏览器发送交易用（公开地址：不要放带密钥的 RPC，或用限定域名的 key）
  EVM_CHAINS, CUSTODY: !MAIN, // 主网关闭托管演示：不生成 / 保管私钥，不代发交易
  DATA_DIR: MAIN ? path.join(__dirname, 'data', 'mainnet') : path.join(__dirname, 'data'),
  D1_PREFIX: MAIN ? 'mainnet:' : '',
  HOT_WALLET_ENV: MAIN ? 'FULFILL_HOT_WALLET_MAINNET' : 'FULFILL_HOT_WALLET' };

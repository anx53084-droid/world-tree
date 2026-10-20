# 主网开关（NETWORK）

默认 `NETWORK=testnet`（不设即为测试网）。所有链相关配置集中在 `network.js`，前端通过 `/api/config` 的 `network / solCluster / solChain / solRpcBrowser / custody` 读取。

## 切到主网（Render → world-tree-ijv1 → Environment，逐个 key 设置）
| 变量 | 值 | 说明 |
|---|---|---|
| `NETWORK` | `mainnet` | 总开关 |
| `SOLANA_RPC_MAINNET` | 你的 RPC URL（含 key，例如 Helius / Triton / QuickNode） | 服务端中继与校验用；不设则用公共 `api.mainnet-beta.solana.com` 并限流 8 次/秒（不建议生产使用） |
| `SOLANA_RPC_BROWSER_MAINNET` | （可选）浏览器发交易用的 RPC | 会公开给前端：只能放无密钥或限定域名的 key；不设用公共 RPC |
| `EVM_RPC_1` / `EVM_RPC_56` / `EVM_RPC_8453` / `EVM_RPC_42161` | （可选）EVM 主网 RPC | 不设用公共 RPC |
| `FULFILL_HOT_WALLET_MAINNET` | （可选）主网打赏热钱包 | 不设则主网不发打赏 / 备注；测试网的 `FULFILL_HOT_WALLET` 不会被用到主网 |

保存后 Render 会自动重新部署；前端不需要重新构建（Pages 每次加载都读 `/api/config`）。

## 主网下的行为
- Solana：`mainnet-beta`；钱包 chain `solana:mainnet`；WalletConnect 用主网创世哈希；MWA 注册 `solana:mainnet`；浏览器链接不带 `?cluster=devnet`。
- EVM：Ethereum (1) / BNB Chain (56) / Base (8453) / Arbitrum One (42161)。
- 收款：`receive-config.js` 的 `CONFIG_MAINNET`。sol / eth / bsc 为已部署的 Squads / Safe；**base / arb 的 `address` 目前为空 → 这两条链不收款**。部署好 Safe 后把地址填进去即可。
- 托管演示关闭：`/api/login`（邮箱）返回 `custodyOff`；EVM 钱包登录返回 `evmMainOff`（EVM 账户依赖服务器托管的 Solana 密钥代签，主网不提供）；所有服务器签名路径（memo / 团购托管支付 / 广告托管支付 / 水龙头）都拒绝。服务器不生成、不保管任何主网私钥，gas 一律由用户自己的钱包支付。
- 水龙头 `/api/airdrop` 与「领 devnet SOL」按钮不可用；Phantom 测试网提示与 Devnet 引导不显示。
- 文案：`i18n/*.json` 中 `键名@main` 为主网措辞（16 种语言，`check:i18n` 校验齐全且不含 devnet / 测试网字样）。
- 数据：主网写入 `data/mainnet/` 与 D1 的 `mainnet:` 前缀，测试网数据（`data/`、无前缀）原样保留，不迁移。

## 回滚
把 `NETWORK` 改回 `testnet`（或删除）即可。测试网数据一直在，主网数据也会保留，再切回主网时继续使用。

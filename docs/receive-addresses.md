# 各链收款地址（多签金库）

**单一配置源：`receive-config.js`**（只有公开地址，无密钥）。服务端校验、`/api/config`、前端显示、交易构造都读它，其它源码里没有硬编码地址。改地址只改这个文件。

| 链 | 当前收款地址 | 类型 | 历史收款地址（只验证旧记录，不再展示） |
|---|---|---|---|
| Solana | `FPKFevoHzjPZWjWaRxwFwfNXu2LBduoGspXZSCLU81yz` | Squads v4 **金库**（vault 0；不是多签账户 `BcrXD8Xa…`） | `2Xjes9L3kePHUKyQaFfueHr933d6V71rPSSF3zZxL6pc` |
| Ethereum | `0xbfa2C12D28838bEA6C92645c195fAa907182ECed` | Safe 1.4.1（2-of-3） | `0x257ae349424c3047a3Acbe02351520d8e5Bd6458` |
| BNB (BSC) | `0x71c04f3C4922d1A6FA2724428d4E2c51f5445837` | Safe L2 1.4.1（2-of-3） | `0x03247ce2bf38bd5e570f13ef7020f4956e350797` |
| Base | `0x257ae349424c3047a3Acbe02351520d8e5Bd6458` | 原地址（该链尚未部署 Safe） | — |
| Arbitrum | `0x257ae349424c3047a3Acbe02351520d8e5Bd6458` | 原地址（该链尚未部署 Safe） | — |
| UNI | `0x4BF1746F3e83b1fb87c9058850B4442cC9AbD740` | 原地址（该链尚未部署 Safe） | — |

多签部署信息见 `docs/multisig.md`（本地文档，未纳入仓库）。

## 行为
- **展示 / 构造**：前端只显示、只转账到“当前地址”。EVM 地址用 EIP-55 校验和格式（配置加载时计算，测试里与给定字符串逐一比对）。
- **校验**（所有比对收款地址的地方：普通心愿支付、追加出价 / 补单、EVM 支付校验）：目的地必须是该链的“当前地址”或“历史地址”。历史地址用于过渡期内识别旧记录与补单，**不会**再出现在界面或 `/api/config` 的展示字段里（只在 `receiveLegacy` / `evm.legacy` 里，供前端统计旧转账）。各链互相独立：BSC 的交易付到 ETH 的地址会被拒绝。
- **环境变量**：`RECEIVE_PUBKEY` / `TREASURY_PUBKEY` / `DEV_PUBKEY` / `EVM_PAY_*` 不再决定当前地址（否则 Render 上遗留的旧值会盖掉新配置），只会被当作**额外的历史地址**。本地不再生成 `data/payees.json` 收款密钥。
- **Solana 金库是 off-curve 的 PDA**：向它转 SOL 就是普通 System Program 转账，`PublicKey` 构造、序列化、签名都不要求地址在曲线上（`verify-receive.js` 覆盖）。**如果将来收 SPL 代币**：收款账户必须是金库的 ATA，用 `getAssociatedTokenAddressSync(mint, vault, true /* allowOwnerOffCurve */)`，并先确保 ATA 已创建；现在站内没有 SPL 收款。注意：从金库里转出资金需要 Squads 提案 + 2 个签名。
- **从历史地址切换完成后**：确认旧记录都已不需要验证，就把 `legacy` 里对应地址删掉。

## 给新链换 Safe
Base / Arbitrum / UNI 部署 Safe 后：在 `receive-config.js` 把该链 `address` 改成 Safe 地址、旧地址放进 `legacy`，推送即可（前端 / 校验 / 文档测试同步用同一份配置；记得更新上表和 `verify-receive.js` 里的期望值）。**在目标链确认 Safe 已部署（`eth_getCode` 非空）之前不要改**——钱打到未部署地址无法取回。

## ⚠️ 测试网提示
站点目前跑在**测试网**：Solana devnet、Sepolia / BSC Testnet / Base Sepolia / Arbitrum Sepolia / Unichain Sepolia。Safe 与 Squads 金库是在**主网**部署的；同一个地址在测试网上通常没有对应合约 / 多签账户（Squads v4 的金库 PDA 由多签账户派生，devnet 上没有这个多签账户），所以测试网付到这些地址的测试币**取不回来**（测试币无价值，但不能用来演示“从金库取出”）。切到主网收款前，请先确认支付链（RPC / chainId）已改成主网，以及各链地址在该链上确实部署。

## 测试
`node verify-receive.js`：地址配置与校验和、旧地址保留为历史、Solana 金库 off-curve 的交易构造、EVM 校验（模拟 RPC，当前 / 历史 / 串链 / 陌生地址）、`/api/config` 输出与旧环境变量处理、源码无硬编码。

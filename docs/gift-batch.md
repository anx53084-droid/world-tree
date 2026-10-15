# 团购礼品卡（Group Gift Cards）

路由：`#/gift/batch`（创建）· `#/gift/batch/<id>`（进度）· `#/claim/<code>`（领取）。代码：`batch.js`（队列/分片/领取码/领取）、`server.js`（`/api/batch/*`、`/api/admin/batch*`）、`public/app.js`（三个页面）。

## 1. 心意资金规则（页面、进度页、本文一致）

- 心意金额是一份祝福心意，**不是购买商品，不是投资**；不产生收益，**不可转让，不可退款**。
- 金额**全额直达项目收款地址**（按链取 `receive-config.js` 中的当前地址），本站不托管、不代持。
- 用途仅限：项目运行成本、正向内容生态（树洞、门卡空间等）的维护，以及提前公告的公益或社区用途。
- 不承诺任何回报：不提供收益、分红、空投或增值预期。
- 批量与单张规则相同；领取码一码一领、绑定领取账户、不可转让。
- 内容只做基础的长度与关键词自动过滤（`blocklist.js` + 现有正向内容审核），无人工审核。
- 页面底部固定声明：「心意金额直达项目地址，仅用于项目运行与正向生态建设，无收益承诺。」（16 种语言）

## 2. 流程

1. 创建页：祝福（≤140）、数量（1–10000）、单张金额（≥ 0.0067 SOL）、门卡名称（≤20 字）、可选项；实时总价 = 数量 × 单价（按 lamports 整数计算）。
2. **一次支付**：
   - 自有 Solana 钱包：客户端签**一笔**转账（总额 → 收款地址）。勾选「公开 1 张」时，同一笔交易带上经审核签名的心愿 memo（`WTREE1|W|…`）和 0-lamport TREE 转账，因此该卡随支付直接出现在世界树，无需第二次签名；否则 memo 为 `WTREE1|BG|pay`。
   - 托管（邮箱）账户：服务端用该账户密钥代签（≥ 20 USD 的大额需改用自有钱包，沿用现有大额限制）。
   - EVM 账户：沿用 `evmPay`（按链收款地址），不支持「公开 / 上链」选项（页面禁用并说明）。
3. 服务端核验（沿用 `verifySolPay` / `Acc.verifyEvmPay`）：交易成功、**签名者 = 当前登录账户**（防他人冒用）、收款方 = 当前或遗留收款地址、到账 ≥ 总额（以链上为准，不信任客户端金额）；`paid[支付签名]` 防重放（同账户重放返回同一批次，他人重放 409）；同一支付签名不能同时用于广告与团购。
4. 通过后创建批次（所有者 = 登录钱包），写入任务队列，页面自动跳转进度页。

## 3. 架构

```
 浏览器 ──(1 笔总额支付)──▶ 链 ──▶ 项目收款地址
   │                          ▲
   │ POST /api/batch/create   │ verifySolPay / verifyEvmPay
   ▼                          │
 ┌──────────────── server.js ───────────────┐
 │ 校验金额/内容 → 核验到账 → Batch.create  │
 └───────────────┬──────────────────────────┘
                 ▼
   batches.json（persist.js → D1 write-through）
   { meta.secret, batches{ shards[] }, codes{sha256 索引}, paid{}, alerts[] }
                 │  Batch.start(): 每 1 秒 tick()
                 ▼
   分片队列（每片 BATCH_SHARD=500 张）
   queued ─▶ running ─▶ done
      ▲          │失败：tries++，指数退避 min(900, 5·2^(n-1)) 秒
      └──────────┘ 超过 BATCH_MAX_TRIES(6) ⇒ failed + 告警日志
   running 超过租约（120 s）视为进程中断 ⇒ 重新排队（断点续传）
                 ▼
   领取码（HMAC 派生）→ codes 索引 → /claim → Gate.issue（门卡 g_…，gateId = b_<批次>）

   [后续项，未接入] IPFS：把祝福/批次清单固定到 IPFS 并在 memo 中记录 CID。
```

- **幂等**：领取码由 `HMAC-SHA256(secret, batchId:序号)` 确定性派生，分片重跑得到相同的码和相同的索引，不会重复发码；批次创建按支付签名幂等。
- **续传**：所有状态在 `data/batches.json`（并同步 D1）。重启后 `Batch.start()` 继续处理未完成分片；进度页可刷新、换设备（同钱包登录）继续看；浏览器 localStorage 仅作为本机备份列表。
- **失败告警**：`alerts`（环形 100 条）+ `console.error('[batch-alert] …')`，不含密钥、不含领取码。`GET /api/admin/batch`（`x-admin-key`）返回汇总、各批次状态与告警；`POST /api/admin/batch/retry {id}` 重新排队失败分片。

### 领取码：哈希 vs 可导出（取舍）

用户需要下载包含明文领取码的 CSV，所以不能只存不可逆哈希。方案：码 = HMAC(服务端密钥, 批次号:序号)，**库中只存 sha256 索引与状态**，需要导出时重新计算。
好处：数据库/D1/备份泄露不会泄露任何未领取的码；重试/重启导出结果完全一致。
代价：服务端密钥 `meta.secret`（或环境变量 `BATCH_SECRET`）一旦泄露，未领取的码可被推算——密钥不进 git、不进日志、不进 API。码为 100 bit（20 位 Crockford base32，格式 `XXXXX-XXXXX-XXXXX-XXXXX`），无法暴力枚举；另有限速。

### 领取与门卡

`#/claim/<code>`：先 `peek`（只返回祝福、门卡名、状态，不泄露所有者），登录后自动 `POST /api/batch/claim` 绑定：一码一领；同一账户重复打开为幂等（不重复发卡）；其他账户 → `used`。发卡走现有 `Gate.issue`（`source=batch`，永久，门卡名 = 批次门卡名称，`gateId = b_<批次号>`）。限速：claim 每 IP / 每账户 20 次 / 10 分钟，peek 每 IP 30 次 / 10 分钟（内存限流）。

### 上链（可选，用于验证）

只对**批次摘要**写一条 memo：`WTREE1|BG|<批次号>|<数量>|<Merkle 根前 32 位>`（Merkle 叶 = 各码索引的哈希）。该交易需要用户用**自己的钱包再签一笔并自付网络费用（gas）**，页面在选项处与进度页都明确提示；服务端 `POST /api/batch/anchor` 用 `verifyMemoTx` 校验（签名者 = 所有者、memo 完全一致）后才显示「已上链」，否则不会假装上链。不对每张卡单独上链。仅自有钱包支持。

### 进度页与 CSV

支付后自动进入；2 秒轮询（失败态 10 秒）；显示已生成/总数、分片、下次重试时间、已领取数。完成后下载 CSV：UTF-8 BOM，表头 `序号,领取码,领取链接,状态`，CRLF，状态为 已领取/未领取；仅批次所有者可下载（需登录令牌）。

## 4. API

| 接口 | 说明 |
| --- | --- |
| `GET /api/batch/cfg` | 公开：最低金额、上限、分片数、收款地址、汇率 |
| `GET /api/batch/peek?code=` | 公开（限速）：领取页预览 |
| `POST /api/batch/create` | 登录：`{blessing,count,unitSol,gateName,optPublic,optAnchor, sig｜pay:true｜evm}` |
| `GET /api/batch/mine` / `GET /api/batch/<id>` / `GET /api/batch/<id>/csv` | 仅所有者 |
| `POST /api/batch/claim` `{code}` | 登录：领取并绑定 |
| `POST /api/batch/anchor` `{id,sig}` | 所有者：登记链上记录 |
| `GET /api/admin/batch`、`POST /api/admin/batch/retry` | 运维（`x-admin-key`） |

环境变量：`BATCH_SECRET`（可选，默认首次启动随机生成并持久化）、`BATCH_SHARD`（500）、`BATCH_MAX_TRIES`（6）、`BATCH_BACKOFF`（5 秒）、`ADS_MOCK_PAY=1`（测试：用 `data/ads-mock-pay.json` 模拟支付核验；`data/batch-mock-anchor.json` 模拟上链核验）。

## 5. 限制

- 数量 1–10000，单张 ≥ 0.0067 SOL；总额必须是安全整数 lamports。
- EVM 账户可支付，但不支持「公开 1 张」「上链」；托管账户不支持「上链」，且 ≥ 20 USD 需自有钱包。
- 「专属门卡空间」= 以批次门卡名称签发的门卡（对接现有 gate 体系），没有新增独立空间功能。
- 内存限流在多实例下各自独立；限流以 IP + 账户为准。
- 无人工审核，仅自动长度/关键词过滤。
- **IPFS 尚未接入**（仅为后续项）。

## 6. 未测试 / 风险

- 真实链上支付（自有钱包签名、托管账户真实转账、EVM 真实转账）、真实钱包的 `signAndSend` 路径、真实上链 memo：测试全部使用 mock（`ADS_MOCK_PAY`），未做真实交易。
- 10000 规模的性能与 Render 单实例/D1 写入压力：单元测试只验证了 10000 码的唯一性与生成正确性，没有压测整批 10000 + D1 同步；`batches.json` 体积随张数线性增长（约 100 字节/张）。
- 密钥派生方案的泄露风险（见上）。
- 翻译为机器辅助，未经母语审校。
- 回归：`node verify-batch.js`（75 项）。

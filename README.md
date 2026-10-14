# 世界树许愿树（World Tree）· MVP

Solana **devnet** 上的许愿树：每个愿望是一张挂在 3D 世界树上的发光卡片。**区块链是唯一事实来源**，网站只读取链上数据并展示；写入由用户自己的 Phantom 钱包签名（自托管，主模式），另附一个**仅供演示**的邮箱托管模式。

> ⚠️ 本项目为演示，运行于 devnet，测试币无价值。托管模式私钥明文存于本地文件，**绝不可用于主网**。

## 运行

```bash
cd /workspace/world-tree
npm install            # 已安装可跳过
node server.js         # 默认 http://localhost:8080 ；可用 PORT / RPC_URL / SOL_USD / ADMIN_KEY / FULFILL_FUND_BPS / FULFILL_HOT_WALLET 覆盖
node verify.js         # 可选：Playwright 无头验证（桌面+移动端），生成截图
```

## 架构

```
浏览器 SPA（public/）
 ├─ 读：/api/rpc 同源中继 → devnet RPC：getSignaturesForAddress(TREE) + getTransaction(jsonParsed)
 │      交易不可变 → 按签名缓存在 localStorage；每 30 秒增量刷新
 ├─ 写（自托管）：前端构建交易 → Phantom signAndSendTransaction → devnet
 └─ 写（托管演示）：/api/memo → 服务器用该用户 devnet 密钥签名发送
server.js（本地 Node）：静态文件、RPC 中继、内容审核+审核证明、演示托管账户、SOL 价格
moderation.js：关键词过滤（中英）+ AI 语义审核桩 + 人工复核队列（data/review-queue.jsonl）
```

### 链上方案：SPL Memo 交易（未使用 Anchor 自定义程序）
原因：本机无 Solana/Anchor 工具链，且**本机网络无法访问 devnet RPC**（无法空投、部署）。Memo 方案不需要部署程序，任何钱包都能写，读取用标准 RPC 即可。
每笔交易包含：
1. （仅许愿）一笔 SystemProgram 转账：全额 → 项目收款地址（用户钱包直接转出，平台不经手；签名时钱包显示收款方）；
2. 一笔 0 lamport 转账到固定索引地址 `TREE = pqaQKFsNjfJKewkwEyJaNYzoKxu3sh1hmNvAGKfz5Yb`（sha256("world-tree-wishes-v1")），用于 `getSignaturesForAddress` 索引；
3. 一条 Memo：
   - 许愿：`WTREE1|W|<sha256(分类|正文)>|<时间戳>|<审核签名hex>|<分类>|<正文≤140>`
   - 祝福：`WTREE1|B|<sha256(愿望签名|正文)>|<时间戳>|<审核签名hex>|<愿望签名>|<正文>`
   - 点赞：`WTREE1|L|<愿望交易签名>`（同一地址对同一愿望只计 1 次）

### 审核证明（attestation）
付款/上链**之前**调用 `/api/moderate`；通过后审核服务用 ed25519 对 `WTREE-ATT1|<内容哈希>|pass|<时间戳>` 签名。哈希与签名随内容写入链上；前端读取时用 `public/config.js` 中固定的审核公钥重新校验，**缺失或无效证明一律不展示**（托管接口也会拒绝）。前端还用同一词表做二次过滤（链上不可删，但可不展示）。
拒绝提示：「您的内容未通过审核（可能涉及违规或不符合正向要求），请修改后重新提交。」并显示命中类别。

### 支付
金额自由填写，最低 1 美元等值 SOL（价格优先取 CoinGecko，失败用常量 `SOL_USD`，默认 150）。全额转入单一收款地址（`RECEIVE_PUBKEY`）。**不实现**任何 LP 收益、分红、循环返利。
收款地址由环境变量 `RECEIVE_PUBKEY` 配置（本地未设时生成 `data/payees.json`）。


### 星愿大使 · 物质类心愿实现（惊喜）
物质类愿望可在购买时填写**可选**收货/联系备注，仅存服务器 `data/fulfillments.json`，**永不入链、不公开展示**。管理员通过 `X-Admin-Key`（`ADMIN_KEY`）调用 `/api/admin/fulfillments` 查看待心愿实现列表并标记已心愿实现；可选 `FULFILL_HOT_WALLET` 在 devnet 发送微量 SOL tip + 链上 memo `WTREE1|F|…`。用户侧仅在愿望被心愿实现后看到徽章「星愿大使已心愿实现」与庆祝提示，规则页**不**描述内部基金或 LP。

> **内部运维（不对用户展示）**：付款全额至单一收款地址。服务器在 `data/fund-ledger.json` 对总支付做纯会计记账「心愿实现基金」，比例由 `FULFILL_FUND_BPS`（默认 2000 = 总支付的 20%）配置。无质押、无收益、无 LP、无分润展示。

### 世界树光谱（灵魂绑定记录）
每次许愿的交易本身就是与作者地址绑定、不可转让的记录；前端由交易哈希确定性生成唯一 SVG 光谱。（真正的 NFT 可后续改用 Token-2022 NonTransferable 扩展铸造。）

### 前端
- 3D 首页：Three.js + OrbitControls；树的分枝层级/树干粗细/规模随卡片数增长并平滑过渡；枝干、叶冠用 InstancedMesh；卡片为发光 Sprite，射线拾取；桌面悬停高亮；拖动与轻点 8px 阈值区分。
- 分层：树核 → 螺旋银河环（ShaderMaterial 闪烁、缓慢旋转、亮度/密度随卡片数）→ 深空星点与星云。
- 月度树态（北京时间）：1–10 上旬·生机蓬勃（绿）、11–20 中旬·樱花盛开（粉）、21–月末 下旬·樱花飘落（花瓣粒子）；场景左上角可切换预览。
- 移动端：单指旋转、双指捏合缩放+平移，像素比上限 1.25，粒子数减半。
- 分类色：经典 暖金 / 风景 天蓝 / 人物 柔粉 / 动物 翡翠绿 / 卡通 暖橙 / 物质类 紫晶。
- 页面（hash 路由）：首页、愿望列表（关键词/分类/时间/热度筛选 + 排序）、详情（祝福、光谱、分享图、浏览器链接）、许愿（购买）、我的世界树、规则与说明、用户协议/购买须知。
- CSS：变量 + 作用域覆盖，`@property` 注册 `--glow-intensity` / `--hue-shift` 平滑过渡；面板滑入、按钮浮入、悬停上浮发光、按下缩放、呼吸提示、弹窗淡入 + 弹性弹出。
- 背景：`public/starfield-worklet.js` CSS Paint Worklet（上限 180 星、密度≤2.5、按元素尺寸播种、count≤0 直接返回），不支持时回退 canvas。
- 交易状态：等待签名 → 已提交/确认中（⏳ 卡片）→ 已确认/失败 提示。

### 换用索引器
只需替换 `public/app.js` 的 `loadWishes()`：例如 Helius Enhanced Transactions / webhook、或自建 Geyser 插件写入 Postgres，提供 `/wishes` API；数据格式不变，仍可随时回落到直接 RPC 校验。

## 扩展到千亿（1e11）张卡片

### 1. 确定性分层地址空间（`public/addr.js`，前后端共用）
- 卡片序号 `i`（按索引顺序 0,1,2…，新卡只追加，旧卡地址永不变）→ **8 级 × 16 叉**路径 + 64 槽位：
  `d_j = floor(i / 16^j) % 16`（j=0..7，**低位优先**），`slot = floor(i / 16^8)`。容量 16⁸×64 ≈ **2.75e11**；不够时在末尾再加一级，旧地址不变。
- 区域（region）= 路径前缀的十六进制串，如 `3a7f01`。前缀 `p`（长 k）下的卡片数是 O(1) 公式：`#{i<N : i ≡ p (mod 16^k)}`。
- 低位优先：前 16 张卡就铺满 16 个大区，树始终均衡；任一卡片的世界坐标只需 O(深度) 计算，**无需加载其它卡片**。
- 稀疏子树折叠：子树卡数 ≤ 64 时卡片直接挂在该节点（4 股流苏），所以 12 张卡时就是一棵 12 枝的小树，千亿张时是 8 层分区。
- 树的视觉尺寸 `0.8 + 0.035·log2(N)`（上限 2），即随总数**对数增长**；成长阶段/银河亮度同样按对数。
- 渲染采用“以当前焦点区域为根”的相对坐标，进入第 7 层也不会出现浮点精度问题。

### 2. 三级 LOD（`public/scene3d.js`）
| 级别 | 何时 | 实现 | 上限 |
|---|---|---|---|
| 远 | 子区卡数 > 64 | 每个孙区域一个发光团（着色器 Points，大小 ∝ log 数量）+ 闪烁粒子，16 个子区显示数量标签 | 256 团，1 次 draw call |
| 中 | 卡片所在挂卡区进入视锥 | `InstancedMesh` + 着色器 billboard 卡片（颜色=分类色相） | 5000（移动 3000），1 次 draw call |
| 近 | 距相机最近、距离 < 26×卡片尺寸 | 带文字的 Canvas 纹理 Sprite，可悬停/点击弹窗 | 200（移动 120），纹理 LRU 释放 |
- 导航：滚轮/双指**朝指针缩放**，靠近某个子区（或缩到最小）自动进入下一级；拉远到阈值自动返回上一级；轻点光团/标签直接进入；右上角面包屑可跳到任意祖先。
- 瓦片加载：相机变化 **150ms 去抖** → 对当前区域内挂卡区做视锥剔除（流苏包围球）→ 按距离排序，直到中景预算 → 每批 16 个区域调用批量接口，最多 64 个并发区域；瓦片 **LRU 800**、计数 LRU 300。
- 搜索：首页输入卡片编号（如 `99999999999`）→ 由编号算出路径 → 只请求该瓦片 → 相机飞到卡片、高亮并弹窗。

### 3. 索引器 API（`server.js` 中为**模拟索引器**）
- `GET /api/tiles/:region?level=count&total=N` → `{count, children[16], grand[256]}`（region 根用 `root`）
- `GET /api/tiles/:region?level=cards&total=N` → 该区域 ≤64 张卡片摘要 `{id,sig,cat,text,likes,blessN,author,time}`
- `GET /api/tiles?regions=a,b,c&level=cards&total=N` → 批量（≤64 个区域），`cache-control: max-age=60`，可直接放 CDN。
- 模拟索引器按序号确定性合成假卡片（同一编号永远同一内容）；真实愿望占用序号 0…R-1 并在前端覆盖。
- 首页勾选「⚡压力模式」并填写总数（默认 100,000,000,000），或直接访问 `/?stress=100000000000`。

### 4. 真实后端（生产设计）
- **链上**：1e11 个账户（每个 ~0.002 SOL 租金）不可行。保留 **Memo 交易 + 索引器**作为主路径；若需要链上可验证的状态（点赞计数、所属权），用 **State Compression / 并发 Merkle 树**（`spl-account-compression`，如 Bubblegum cNFT）：每棵树 depth 30 可容纳 ~10.7 亿叶子，约 100 棵树即可覆盖 1e11，链上只存根哈希，叶子数据由索引器（DAS API）提供并附 Merkle 证明。
- **采集**：Helius webhooks / Enhanced Transactions 或自建 Geyser 插件 → Kafka → 解析 memo、校验审核签名 → 按到达顺序分配全局序号 `i`（单调序列，序号即地址）。
- **存储**：明细放 **ClickHouse**（或 Postgres 按 `region_prefix(4)` 做 LIST/HASH 分区，65536 个分区），主键 `(region8, slot)`；区域计数用物化视图在 1–6 级前缀上预聚合（`SummingMergeTree`），`level=count` 只读预聚合表。删除/审核下架只打标记，序号不复用。
- **服务**：瓦片接口无状态、强缓存（CDN + Redis 热点区域），近 1 级瓦片按需回源；搜索按编号直接定位，按文本搜索交给 OpenSearch。
- 前端无需改动：把 `fetch('/api/tiles…')` 指向真实索引器即可。

### 5. 实测（无 GPU 的 SwiftShader 软件渲染，headless Chromium，`verify-scale.js`，压力模式 1e11）
| 视口 | 视图 | FPS | 平均/P95 帧时间 | draw calls | 卡片（中/近） | JS 堆 |
|---|---|---|---|---|---|---|
| 桌面 1280×900 | 远（根） | 15.6 | 64 / 120 ms | 25 | 0 / 0（256 光团） | 8.6 MB |
| 桌面 | 中（第 6 层） | 8.7 | 115 / 251 ms | 26 | 5000 / 0 | 14.2 MB |
| 桌面 | 近（第 7 层） | 15.2 | 66 / 102 ms | 172 | 373 / 200 | 10.7 MB |
| iPhone 13 | 远 / 中 / 近 | 38.7 / 13.2 / 36.8 | 26 / 76 / 27 ms | 25 / 26 / 55 | 0 / 2986 / 120 | 7.0 / 10.2 / 8.8 MB |
| 对照：桌面 | 改版前（12 张卡） | 18.8 | — | — | — | — |
软件渲染下帧率受填充率限制（与卡片总数无关）；有 GPU 的真实设备会高得多。内存与总数 N 无关，只与可见预算相关。截图见 `shots/`。

### 已知限制
- 序号是全局顺序分配的，需要索引器单点（或分段）发号；多索引器需按区段分配。
- 模拟索引器的计数是公式；真实系统计数会因下架变化，前端已通过 `level=count` 接口读取，不依赖公式（编号搜索在模拟模式下用公式求挂卡层级，真实后端应提供 `/api/locate/:id`）。
- 近景每张文字卡 1 次 draw call（≤200）；如需更高可改为纹理图集 + 实例化。
- 压力模式下的合成卡不可点赞/祝福（无链上交易）。

## 部署
- 前端静态文件可放任意静态托管（需要同源的 `/api/moderate` 审核服务；纯自托管读写可直接改 `RPC_READ` 为公共 RPC）。
- 生产需：审核密钥与托管密钥放 KMS/HSM、真实身份验证（邮箱验证码等）、专业内容安全服务、合规评估；或直接取消托管模式。
- 若要改为 Anchor 程序：安装 Solana CLI + Anchor，`solana airdrop` 后 `anchor deploy --provider.cluster devnet`，用 PDA 存愿望/点赞并在程序内校验审核签名（Ed25519 预编译程序）。

## 路线图
- 审核签名由多节点**门限签名**（t-of-n）产生，避免单点信任；
- **ZK 证明**：证明内容通过某审核模型/规则而不暴露审核细节；
- 内容（含图片）存 **IPFS / Arweave**，链上只存 CID + 哈希 + 元数据；
- **去中心化推理**网络执行 AI 语义审核；
- Anchor 程序化 + Token-2022 不可转让光谱 NFT。

## 文件
server.js · moderation.js · fulfillment.js（心愿实现 + 内部记账） · verify.js · verify-scale.js · verify-fulfill.js · shots/ · public/{index.html, app.js, addr.js, scene3d.js, style.css, i18n/, starfield-worklet.js, config.js(自动生成), vendor/} · data/（users.json、moderator.json、payees.json、fulfillments.json、fund-ledger.json、review-queue.jsonl —— 演示/运营数据，勿提交）

## 自定义模板图片（我的星愿 → 制作我的心愿卡）
- 浏览器内压缩为 ≤800px、≤300KB 的 webp/jpeg，`POST /api/img` 上传，`GET /api/img/<hash>` 读取；memo 只记录 `~C<封面哈希>` / `~N<内页哈希>`（32 hex，旧客户端忽略，显示内置封面）。
- 上传即自动审核：MIME 白名单、文件头校验、大小、尺寸（16–1024px）；NSFW 检测默认使用服务器内置的开源分类器 nsfwjs（MobileNetV2，纯 JS tfjs + sharp 解码，在 worker 线程中于首次上传时懒加载（本地约 3s，Render 0.1 CPU 上更慢），进程常驻内存约 200MB；自检失败或出错均拒绝）：Porn≥.5 / Hentai≥.5 / Sexy≥.7 / 三者和≥.85 拒绝（`NSFW_T_PORN`/`NSFW_T_HENTAI`/`NSFW_T_SEXY` 可调）；分类器出错则拒绝（fail closed）。可选 `NSFW_URL` 覆盖为外部服务（返回 `{nsfw:0..1}`，阈值 `NSFW_MAX`）。 `/api/moderate` 会拒绝引用未上传图片的卡片。
- 私密卡内页图：浏览器内用同一 AES-GCM 密钥加密，服务器审核明文但只保存密文（与文字一致，服务器无法验证密文与明文对应）。封面图公开。
- ⚠️ 持久化：Render 免费实例磁盘是临时的，重启/重新部署后 `data/img` 丢失（卡片回退到内置封面 / 内页无图）。免费可选：Cloudflare R2 免费额度、Backblaze B2 免费 10GB，或 IPFS 固定服务免费档（如 Pinata/web3.storage）；付费可选 Render Disk。

### Cloudflare R2（可选，持久化图片）
设置 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`（可选 `R2_PUBLIC_URL`，如 r2.dev 公共域名，读取时 302 跳转）即改为存 R2；未设置则存本地 data/img。

## Cloudflare Pages 前端（API 仍在 Render）
- Pages 项目：连接 GitHub `anx53084-droid/world-tree`，分支 `main`；Framework preset: None；Build command: `node scripts/build-pages.js`；Build output directory: `public`。
- 构建脚本生成 `public/config.js`（`apiBase` = `https://world-tree-ijv1.onrender.com`，审核公钥内置）与 `public/_headers`（`x-wt` 供 Service Worker 识别）。可用 Pages 环境变量 `WT_API_BASE` / `WT_MODERATOR_PUBKEY` 覆盖。
- 服务器 CORS：默认允许 `https://world-tree.pages.dev` 及其预览子域（`<hash>.world-tree.pages.dev`）；前端由 GitHub Actions（.github/workflows/pages.yml）在 push main 时自动部署；自定义域名加到 Render 环境变量 `ALLOWED_ORIGINS`（逗号分隔），或用 `CORS_ORIGIN_RE` 覆盖规则。鉴权使用 Bearer token（localStorage），不依赖 cookie。
- 冷启动：前端静态资源由 Cloudflare 提供，树立即渲染；`/api` 幂等请求在服务器唤醒期间自动重试（≤90s），显示「正在唤醒服务器」提示；链上读取超时后浏览器直连 devnet。

## 多链钱包 · 安全设置 · 站内信
- **钱包**（非托管，只请求签名）：Solana — Phantom / Solflare / Backpack / OKX（Wallet Standard 优先，注入式回退）；EVM — MetaMask / OKX / Coinbase / 任意 EIP-6963 钱包，可切换 BSC Testnet、Base Sepolia、Sepolia、Arbitrum Sepolia、Unichain Sepolia。移动端未检测到钱包时用各钱包深链接在其内置浏览器打开本站。
- **登录**：EIP-4361 风格消息（一次性 nonce，5 分钟有效，校验域名）。EVM 用 `personal_sign`（服务器 secp256k1 恢复地址），Solana 用 `signMessage`（ed25519）。愿望仍以 Solana devnet 为唯一事实来源：EVM 账户由服务器托管一个 devnet 密钥签 memo（演示）。
- **EVM 支付**：按链设置 `EVM_PAY_ETH` / `EVM_PAY_BSC` / `EVM_PAY_BASE` / `EVM_PAY_ARB`（及可选 `EVM_PAY_UNI`）后开启；用户钱包发送**一笔**原生币转账至该链收款地址。含 Unichain Sepolia（chainId 1301，`EVM_PAY_UNI`）。服务器经各链 RPC（`EVM_RPC_<chainId>` 可覆盖）核验发送者、收款方、金额 ≥ 1 美元且未被重复使用后再上链。未设置时只显示 EVM 登录。
- **安全设置** `#/security`：已登录设备列表、单独退出 / 退出其他所有设备；邮箱验证（需 `RESEND_API_KEY` + `MAIL_FROM`）；邮箱账户可选 TOTP（Google Authenticator，RFC 6238）；大额支付确认（默认 ≥ 20 美元，开启 2FA 时需验证码，服务器同样校验）。
- **站内信** `#/inbox` / **消息设置** `#/notify`：打开页面或菜单时获取，不轮询。星愿大使通过 `POST /api/admin/fulfillments/fulfill` 标记心愿实现时给愿望主人发站内信；`POST /api/admin/notice {title, body}` 发系统通知（`GET /api/admin/notice` 列表、`POST /api/admin/notice/delete {id}` 删除）（均需 `x-admin-key`）。

## 持久化（Cloudflare D1）
设置 `D1_API_TOKEN`（Account › D1 › Edit）、`D1_ACCOUNT_ID`、`D1_DATABASE_ID` 后，服务启动时从 D1（库 `guangqi-db`，表 `kv`）拉取账户、会话、两步验证、恢复码、站内信、通知设置、心愿实现记录与资金账本、审核密钥等到 `data/`，之后每次写入按条目差量写回 D1（内存缓存 + write-through）。拉取失败则拒绝启动，避免用空数据覆盖。一次性 nonce 与登录票据（≤10 分钟）仅存内存。未设置时只用本地文件（Render 重新部署会清空）。图片仍需配置 R2 才能持久保存。

# 钓鱼 / 短链黑名单

## 数据流

```
多来源（sources.json） ──► scripts/convert-blocklist.js ──► public/blocklist.json（完整）
        ▲  每日 GitHub Actions                          └► public/blocklist-core.json（短链+地址+签名，小）
        │                                                        │
   whitelist.json / extra.txt                     Cloudflare Pages 静态托管（ETag，5 分钟缓存 + SWR）
                                                     │                          │
                                  Render 服务器 blocklist.js（权威）     前端 loadBlocklist()
                                  启动读本地文件→拉取 Pages→每日刷新      core 常驻 / 完整表按需
                                  /api/moderate 在出具审核证明前拦截       制作页预检、列表/树/搜索隐藏
```

## 来源与格式（`scripts/blocklist/sources.json`）

| format | 说明 |
|---|---|
| `metamask` | MetaMask eth-phishing-detect `config.json` 的 `blacklist` |
| `json-array` | JSON 数组（或 `{domains:[]}`、对象键） |
| `text` / `hosts` | 每行一个，支持 `#` 注释与 hosts 格式 `0.0.0.0 域名` |

`target` 可为 `domains` / `addresses` / `sigs`。`optional: true` 的来源失败时跳过；必需来源失败则不写文件（保留上一版）。
内置短链表（bit.ly、tinyurl.com、t.co、cutt.ly、rebrand.ly、short.io、tiny.cc、lnkd.in、is.gd、goo.gl、ow.ly 等）写入 `shorteners`。

过滤规则：去协议 / 路径 / 端口 / `www.`，转小写；长度 4–253、必须含点、仅 `[a-z0-9.-]`、标签合法；排除 IP、`localhost`、`*.local`、`*.test`、`*.example`、`*.invalid` 等；去重；命中白名单（含父域，如本站 `world-tree.pages.dev`、`onrender.com`、`solana.com`、`phantom.app`、`metamask.io`）的剔除。
输出按字母排序、一行一项，git diff 只显示增删。**若结果比上一版缩水 >50% 则拒绝写入**（`--force` 覆盖），防止上游故障清空名单；内容无变化时不改 `updatedAt`、不产生提交。

输出：`{version, updatedAt, sources, domains, shorteners, sigs, addresses}`。

## 存储建议

- **首选：Pages 静态文件**（当前方案）。免费、全球 CDN、自动 ETag/304、随 git 版本化可审计可回滚；每日 Action 有变化才提交并部署。
- 完整表约 9 MB（压缩传输约 2 MB），因此前端**只常驻 `blocklist-core.json`（约 110 KB，存 localStorage）**，完整域名表只在需要时加载并存入 Cache Storage（制作页、或卡片文本里出现疑似域名时）。
- 服务器端把完整表加载为内存 `Set`（约 40 万项，几十 MB 内存），O(域名层级) 查询。
- 若名单继续增大（>25 MB 单文件上限或前端过重），可改为：R2 存完整表 + 前端用布隆过滤器（~1% 误报，命中再问服务器），或在 D1 建 `blocked(domain PRIMARY KEY)` 表由服务器查询。

## 关键代码

- `public/blockmatch.js`（前后端共用 UMD）：`norm()` 处理全角句点、`[.]`/`(.)`/` dot ` 等混淆与零宽字符；`hosts()` 抽取域名；`hitHost()` 逐级父域匹配（`a.b.bit.ly` → `bit.ly`），先短链后钓鱼；`checkText()` 同时检查文本中的诈骗地址。
- `blocklist.js`（服务器）：启动读 `public/blocklist.json`，5 秒后与之后每 24 小时用 `If-None-Match` 拉取 `BLOCKLIST_URL`（默认 `https://world-tree.pages.dev/blocklist.json`），缩水 >50% 拒绝替换；`/api/blocklist/info` 查看状态。
- `server.js` `/api/moderate`：在关键词 / AI 审核与签发审核证明**之前**调用 `Block.check(text)`，命中返回 `code: blockShort | blockPhish | blockAddr` 与 `domain`。没有证明的愿望前端不会展示，因此服务器端是权威。
- `public/app.js`：`loadBlocklist(full)`（ETag 条件请求，core→localStorage，完整→Cache Storage）；`aggregate()` 中 `blkHit()` 按签名 / 作者地址 / 文本过滤愿望与祝福——列表、搜索、3D 树都基于 `S.wishes`，因此一并隐藏；黑名单到达后原地 `aggregate()+refreshView()`，不重建场景。制作页输入时 `#blkwarn` 本地化提示，付款前再次拦截。
- `public/sw.js` 不缓存 `/blocklist*`（由页面自行管理），`_headers` 为其设置 `max-age=300, stale-while-revalidate=86400`。

## 手动操作

```bash
node scripts/convert-blocklist.js            # 合并并写出
node scripts/convert-blocklist.js --force    # 允许大幅缩水
```
补充域名写入 `scripts/blocklist/extra.txt`；误报加入 `scripts/blocklist/whitelist.json`。需要隐藏的具体卡片签名可作为 `target: "sigs"` 的来源加入。

## 许可

上游名单各有许可证（MetaMask eth-phishing-detect、ScamSniffer scam-database），再分发前请确认其条款。

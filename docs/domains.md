# 多域名与一键换域（后手方案）

目标：当前域名被浏览器 / 钱包标记为有问题时，几分钟内把用户切到备用域名，无需重新部署 API。

## 组成
- **域名清单**（API）：`GET /api/domains`（公开）→ `{domains:[{host,status:active|standby|blocked,primary}], updatedAt}`。数据在 `data/domains.json`，经 persist.js 同步 D1。首次启动用 `DOMAINS_SEED`（逗号分隔，首个为主域，默认 `world-tree.pages.dev`）播种。
- **动态 CORS**：白名单 = 清单内全部域名（含 blocked，旧域用户仍要能拉到“请换域”提示）+ `ALLOWED_ORIGINS` + `CORS_ORIGIN_RE`（默认 `*.world-tree.pages.dev`）。只接受 `https://host`（无端口、无后缀欺骗）。增删域名**立即生效，不需重新部署**。
- **前端提示条**（`public/domains.js`）：启动拉取清单（4 秒超时 → localStorage 缓存 → 内置默认清单；构建变量 `WT_DOMAINS` 可改默认清单）。
  - 当前域名在清单里且是 **blocked** → 红色提示条，探测目标可达后 8 秒倒计时**自动跳转**（可取消）；
  - **非主域**且主域 active → 黄色提示条，**一键前往**（可“留在此处”）；
  - 不在清单里的域（本地、预览）不处理；刚从别的域迁移来的不再自动跳（防乒乓）。
  - 跳转目标**只取自清单**（格式合法 + 在清单内 + 非 blocked），不读 URL 参数里的目标，防开放重定向。
  - 跳转保留路由 hash 和 `?lang`；`localStorage` 不能跨域，所以仅用 `?_mig=` 带白名单内的非敏感设置（语言、条款已读、链选择、压力测试开关等）。**登录会话、钱包选择、历史、缓存绝不携带**，用户需在新域重新连接钱包并签名（提示条和到达提示都会说明）。
- **管理端点**（`x-admin-key` = `ADMIN_KEY`）：`GET /api/admin/domains`、`GET|POST /api/admin/domains/check`（HEAD 探测每个域名）、`POST /api/admin/domains {action:add|primary|status|remove, host, status}`、`POST /api/admin/domains/failover`（主域不通 / blocked → 自动切到健康的备用域，并把旧主域标 blocked）。规则：blocked 域不能设为主域；主域不能直接降级或删除（先换主域）。
- **og / canonical**：`functions/_middleware.js` 用当前请求的 origin 改写 og:url / og:image / canonical / hreflang；前端 SEO 脚本用 `location.origin`。

## 当前域名（guangqi.world）
- 首选域名：`guangqi.world`（Cloudflare Pages 项目 `world-tree` 的自定义域名）；`www.guangqi.world` 备用；`world-tree.pages.dev` 保留为备用。
- **代码里的内置补齐**：`DOMAINS_ENSURE`（默认 `guangqi.world,www.guangqi.world`）——API 启动时把清单里缺失的这些域名补成 **standby**（不改已有域名的状态，也不改主域），所以 Render 部署后 CORS 立即允许它们，不需要 ADMIN_KEY。
- **设为主域必须用管理端点**（需要 `ADMIN_KEY`，只放环境变量）：
  `ADMIN_KEY=… node scripts/domains.js primary guangqi.world`（pages.dev 自动保持 active 作为备用；`www` 保持 standby）。
- 前端内置回退清单（API 不可达且无缓存时）默认 `guangqi.world`（主）+ `world-tree.pages.dev`，可用仓库 Variables `WT_DOMAINS` 覆盖。
- 站内不再写死域名：分享链接 / 钱包 appIdentity（MWA、WalletConnect、Dynamic）都用 `location.origin`；og / canonical 由 `functions/_middleware.js` 用当前请求的 origin 改写（静态 HTML 里的默认值是 guangqi.world）；og 图上的网址文字为 guangqi.world（`node scripts/og/gen.js` 生成）。`blocklist.js` 仍从 pages.dev 拉取 blocklist（备用域名，保持可用即可）。
- 第三方后台要同步添加新域名：Dynamic → Security → Allowed Origins 加 `https://guangqi.world`、`https://www.guangqi.world`；Reown（WalletConnect）→ 项目 → Domain allowlist 加 `guangqi.world`、`www.guangqi.world`（填项目 ID 后才需要）。pages.dev 的条目保留。

## 怎么加新域名
1. 买域名（注册商任选），在 Cloudflare 添加站点或把 DNS 指到 Cloudflare。
2. Cloudflare Pages → 项目 `world-tree` → Custom domains → 绑定新域名（同一个项目可绑多个域名，部署一次全部生效）。如要完全独立的备份，另建 Pages 项目并在 GitHub 仓库 Variables 设置 `WT_EXTRA_PAGES_PROJECTS=proj-b,proj-c`，同一份构建会被部署到这些项目（不设置则跳过，不报错）。
3. 加入清单（备用域先用 standby）：
   `ADMIN_KEY=… API_BASE=https://<API域名> node scripts/domains.js add new.example.com standby`
4. （可选）仓库 Variables 设置 `WT_DOMAINS=main.example.com,new.example.com` 作为前端内置默认清单（API 不可达时回退），重新部署一次。
5. 验证：`node scripts/domains.js check`（逐个 HEAD 探测），浏览器打开新域，确认能正常调用 API。

## 一键换域
```
export ADMIN_KEY=…            # 仅放环境变量，不要写进仓库
export API_BASE=https://<API域名>
node scripts/domains.js check                      # 看哪些域可用
node scripts/domains.js primary new.example.com    # 设为主域
node scripts/domains.js block old.example.com      # 旧域标 blocked → 旧域用户看到提示并自动跳转
node scripts/domains.js failover                   # 或：主域不通时自动选健康备用域
```
等价的 HTTP 调用见上面的管理端点。清单有 30 秒缓存，几十秒内用户打开站点即看到提示。截图见 `shots/domains-*`。

## MetaMask（eth-phishing-detect）误报申诉
MetaMask 的“可疑站点”警告来自开源列表 [MetaMask/eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect)。
1. 先确认：在该仓库的 `src/config.json` 里搜索你的域名（blacklist）。
2. 到该仓库提 Issue（选择误报 / false positive 类模板）或直接提 PR：说明站点用途、项目地址与源码仓库、域名归属证明（如 DNS TXT / 官方社交账号发布的链接）、站点不含钓鱼行为；PR 一般是把域名加入 `whitelist`（或从 `blacklist` 移除）。
3. 合并后 MetaMask 会定期同步列表（通常数小时到数天）；期间使用备用域名。
4. 同时处理其它来源（视情况）：Google Safe Browsing 的误报反馈（Search Console 的安全问题页或 Safe Browsing 的 report-error 页面）、Microsoft SmartScreen 反馈、各钱包（如 Phantom）的支持渠道。
5. 预防：新域名先少量使用，页面不要有仿冒其它品牌的文案 / logo；保持 `blocklist` 白名单里只有自己的域名。

> 以上申诉入口以各方官方页面为准，格式和流程可能变动。

## 需要你做的事
买域名并绑定 Pages 自定义域名（或另建 Pages 项目）、把域名加进清单、（可选）设置仓库 Variables `WT_DOMAINS` / `WT_EXTRA_PAGES_PROJECTS`、在 Render 确认 `ADMIN_KEY` 已设置。
## 测试
`node verify-domains.js`：清单规则、动态 CORS（无需重启）、管理鉴权、故障转移、前端决策、开放重定向防护、迁移参数白名单、中间件不写死域名。

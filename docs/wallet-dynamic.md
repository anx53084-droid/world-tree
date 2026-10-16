# 邮箱 / Google 登录（Dynamic 嵌入式 Solana 钱包）

连接面板新增一项「邮箱 / Google 登录」。登录成功后自动创建 **非托管** 的 Solana 嵌入式钱包（Dynamic WaaS，私钥分片由用户持有；本站和平台都拿不到私钥），然后和其他钱包一样走现有的连接 → 签名登录（`signMessage`）→ 自动重连流程，交易走 `signTransaction`（只签名，由用户自己的会话发到链上）。

## 实现
- 站点是原生 JS，所以用 Dynamic 的无界面 JS SDK（`@dynamic-labs-sdk/client` + `@dynamic-labs-sdk/solana`，只注册 `addWaasSolanaExtension`），打包成 `public/vendor/dynamic.js`（约 1.4MB，**点击该项或上次用的是它时才加载**）。入口源码：`scripts/vendor-src/dynamic.js`；重新打包命令同 `docs/wallet-mobile.md`（`npm i @dynamic-labs-sdk/client @dynamic-labs-sdk/solana esbuild`，`esbuild dynamic.js --bundle --minify --format=iife --platform=browser --define:global=globalThis --define:process.env.NODE_ENV='"production"'`）。
- 适配层：`public/wallets.js` 里的 `dynAdapter()`（和 MWA / WalletConnect 一样，是 `solWallets()` 里的一项，接口 `connect / signMessage / signAndSend / onChange / disconnect`）。
- 登录界面：`public/app.js` 的 `dynLogin()`（邮箱 → 验证码；或 Google）。邮箱 OTP：`sendEmailOTP` → `verifyOTP` → `createWaasWalletAccounts`（创建钱包不是自动的，必须调用）。Google：`signInWithSocialRedirect`（整页跳转），回到本站后启动时 `dynResume()` 调 `completeSocialRedirect` 并继续连接。
- 自动重连：Dynamic 会话由 SDK 存在浏览器本地；本站另存 `wt_wallet=dynamic`，页面加载时静默恢复（不弹窗）。退出登录会同时退出 Dynamic 会话。
- Environment ID：服务端环境变量 **`DYNAMIC_ENV_ID`**，通过 `GET /api/config` 的 `dynamicEnvId` 下发给前端（公开标识，不是密钥；已写入 `render.yaml`，`sync: false`，需在 Render 后台填值）。未配置时点击该项只提示「尚未配置」。
- 网络：嵌入式钱包只负责签名；链上网络为 Solana devnet（与站点一致）。**本站不代发任何交易，网络费用由用户自己的钱包支付**（新建的嵌入式钱包地址在 devnet 上没有 SOL，需要先领取测试币才能支付网络费）。

## 需要在 Dynamic 后台（app.dynamic.xyz）做的设置
1. 创建项目，复制 **Environment ID**（Developers → API & SDK Keys），填到 Render 环境变量 `DYNAMIC_ENV_ID`（生产）；本地开发用同名环境变量。
2. **Chains & Networks**：启用 **Solana（SVM）**，并把网络设为 **Devnet**（只勾 Devnet）。
3. **Log in & User Profile**：打开 **Email**（邮箱 OTP）和 **Google**（Social → Google；需要时按 Dynamic 指引填 Google OAuth 的 Client ID / Secret，或先用 Dynamic 提供的共享测试凭据）。
4. **Wallets → Embedded wallets**：启用嵌入式钱包（Dynamic 的 WaaS / MPC 钱包），并确保「登录后创建」所需的 Solana 链已开启。
5. **Security → Allowed Origins**（CORS 白名单）：加入生产站点的 **完整 origin**（含协议，如 `https://<你的 Pages 域名>`、自定义域名及 `www` 版本；不带路径和尾斜杠）。Pages 的预览域名（`*.pages.dev`）如需测试也要逐个加。本地调试加 `http://localhost:<端口>`。没加的域名会被浏览器 CORS 拦截，表现为「连接失败：Failed to fetch」。
6. **Google 跳转回调**：Google 登录用整页跳转，回到 `https://<域名>/`（站点根）。如 Dynamic 后台有 Redirect URLs / Allowed redirect 之类的配置，把同一个根地址加进去；如果你自己填了 Google OAuth 凭据，还要在 Google Cloud Console 把 Dynamic 给出的回调地址加进授权重定向 URI。
7. 其他项：如开启了 MFA、设备注册（Device Registration）或步骤验证（Step-up），该 JS SDK 是无界面的，本站目前**没有**实现这些界面，登录会被卡住——请先关闭，或告诉我再做。

## 未覆盖 / 风险
- 没有用真实 Environment ID 做过端到端验证（邮箱 OTP、Google 回跳、钱包创建、签名登录、交易签名都没真跑）；已验证：vendor 包能加载并初始化 SDK、未配置提示、登录弹窗的手机视口界面、邮箱格式校验和错误提示。
- `signMessage` 返回的签名编码按「base58 / hex / base64 的 64 字节」兼容解析，没有对真实返回值核对；交易签名通过「序列化 → 在 vendor 内用自带的 web3.js 还原 → `signTransaction` → 序列化」传递，避免两份 web3.js 的类不一致，同样未真跑。
- 包体积大（约 1.4MB，按需加载）；不随 npm 依赖自动更新。
- Dynamic 为第三方托管服务：登录与钱包创建依赖它在线；邮箱 OTP 有频率限制（每邮箱 10 分钟 3 次）。
- 非托管但有恢复边界：用户丢失登录方式时的钱包恢复由 Dynamic 的流程决定，本站无法代为找回。

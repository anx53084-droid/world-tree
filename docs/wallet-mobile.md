# 手机浏览器钱包连接

背景：手机普通浏览器不会注入 `window.solana` / `window.phantom`。连接面板按下面顺序处理（代码：`public/wallets.js`、`public/app.js`）。

1. **自动重连 + 顶部状态**：连接成功后本地保存上次的钱包 id / 名称 / 公钥（`wt_wallet` / `wt_wname` / `wt_wpk`）。页面加载时先静默重连：Phantom 等注入钱包用 `connect({ onlyIfTrusted: true })`，Wallet Standard 钱包用 `standard:connect({ silent: true })`，MWA 用缓存的 authToken（不拉起钱包 App），WalletConnect 恢复已有会话。顶部固定显示状态胶囊：正在重连 / 已连接地址 / 需要重连（点击打开连接面板）。
2. **手机浏览器无注入钱包**：面板提示「手机浏览器无法直接连接钱包，请在钱包 App 内打开本站」，每个钱包给一键深链接（在钱包内置浏览器里打开当前页面）：
   - Phantom：`https://phantom.com/ul/browse/<encodeURIComponent(当前URL)>?ref=<encodeURIComponent(当前域名 origin)>`
   - Solflare：`https://solflare.com/ul/v1/browse/<编码URL>?ref=<编码origin>`
   - Backpack：`https://backpack.app/ul/v1/browse/<编码URL>?ref=<编码origin>`
   - OKX：`okx://wallet/dapp/url?dappUrl=<编码URL>`
   - EVM 标签：MetaMask `https://metamask.app.link/dapp/<URL 去掉协议>`、OKX、Coinbase `https://go.cb-w.com/dapp?cb_url=<编码URL>`
3. **Android Chrome：Mobile Wallet Adapter**（`@solana-mobile/wallet-standard-mobile` 0.7.0，打包成 `public/vendor/mwa.js`，仅 Android + 安全上下文才加载）：appIdentity = `{ name: '光栖', uri: 当前域名, icon: og-image.png }`；注册为 Wallet Standard 钱包后排在列表第一位并标「推荐」。连接走钱包的 `solana:signIn`，**连接与签名登录合并为一次钱包操作**；authToken 持久化在 `localStorage.wt_mwa_auth`，用于静默重连与后续签名的 reauthorize。主动登录时会跳过缓存取新的 sign-in 结果（旧缓存里的签名 nonce 已失效）。退出登录会清除。
4. **WalletConnect（兜底）**：列表末尾的「WalletConnect」（Solana 命名空间，`@walletconnect/universal-provider` 打包成 `public/vendor/walletconnect.js`，点击时才加载）。二维码与「打开钱包 App」按钮由站内弹窗显示（不用官方弹窗）。**需要服务端环境变量 `WC_PROJECT_ID`（Reown / WalletConnect Cloud 项目 ID，公开标识，不是密钥）**；未配置时点击只提示「尚未配置」。

重新打包 vendor：见 `scripts/vendor-src/`（`npm i @solana-mobile/wallet-standard-mobile @walletconnect/universal-provider esbuild`，再 `esbuild <入口> --bundle --minify --format=iife --platform=browser --define:global=globalThis`）。

## 关于网络费用
本站不代任何人发送交易；签名和网络费用（gas）都由发起交易的用户自己的钱包承担。

## 未覆盖 / 风险
- 没有真机验证：MWA（需要 Android 真机 + 钱包 App）、各钱包深链接是否在其最新版本中仍可用、WalletConnect 配对（需要项目 ID 与真实钱包）。截图使用手机视口 + 模拟 UA / 模拟注入 provider。
- WalletConnect 只接了 Solana；EVM 标签页没有 WalletConnect。
- WalletConnect 交易签名用 `solana_signTransaction`（钱包签名后由前端广播），部分钱包只支持 `solana_signAndSendTransaction`，未做该分支。
- MWA 的 vendor 包约 176KB、WalletConnect 约 490KB（按需加载），打包产物不随 npm 依赖自动更新。

## EVM（手机）

- WalletConnect（eip155，与 Solana 共用 Reown 项目 `WC_PROJECT_ID`，会话前缀 `wt-evm` 与 Solana 分开）：桌面显示二维码，手机可用「打开钱包」唤起任何支持 WalletConnect 的钱包。链：Sepolia、Base Sepolia、Arbitrum Sepolia、BSC Testnet；切链用 wallet_switchEthereumChain（钱包未授权该链时返回 4902）。
- 深链接：MetaMask、OKX、Trust Wallet（link.trustwallet.com/open_url）、Bitget（bkcode.vip）在 App 内置浏览器中打开本站。
- EVM 没有 Mobile Wallet Adapter（那是 Solana 专用协议），不显示 MWA 入口。

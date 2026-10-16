// Cloudflare Pages 构建：生成静态前端配置（API 基址 + 审核公钥，前端无需请求服务器即可校验链上审核证明）
// Pages 设置：Build command = node scripts/build-pages.js；Build output directory = public
// 可用环境变量覆盖：WT_API_BASE、WT_MODERATOR_PUBKEY
const fs = require('fs'), path = require('path');
const api = (process.env.WT_API_BASE || 'https://world-tree-ijv1.onrender.com').replace(/\/$/, '');
const mod = process.env.WT_MODERATOR_PUBKEY || '21d397cb8b122e5513c71ee78ba47ba449a4c46cbd9b7290b3c9b464f068438e';
if (!/^[0-9a-f]{64}$/.test(mod)) throw new Error('bad moderator pubkey');
const pub = path.join(__dirname, '..', 'public');
const doms = (process.env.WT_DOMAINS || '').split(',').map(x => x.trim().toLowerCase()).filter(x => /^([a-z0-9-]+\.)+[a-z]{2,24}$/.test(x)); if (!doms.length) doms.push('guangqi.world', 'world-tree.pages.dev'); // 默认：guangqi.world 为首选，pages.dev 备用 // 内置默认域名清单（/api/domains 不可达时的回退，首个为主域）
fs.writeFileSync(path.join(pub, 'config.js'), `window.WT_CONFIG = { moderatorPubkeyHex: '${mod}', apiBase: '${api}'${doms.length ? ", domains: " + JSON.stringify(doms) : ''} };\n`);
// _headers：x-wt 让 Service Worker 识别真实响应；第三方库长缓存
fs.writeFileSync(path.join(pub, '_headers'), `/*\n  x-wt: 1\n/vendor/*\n  cache-control: public, max-age=604800, stale-while-revalidate=2592000\n/models/*\n  cache-control: public, max-age=604800\n/blocklist*\n  cache-control: public, max-age=300, stale-while-revalidate=86400\n  access-control-allow-origin: *\n/og-image.png\n  cache-control: public, max-age=86400, stale-while-revalidate=604800\n/og/*\n  cache-control: public, max-age=86400, stale-while-revalidate=604800\n`);
console.log('pages config:', api);

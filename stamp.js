// 静态资源破缓存：给 index.html 里引用的本站 css/js 加 ?v=<内容哈希>，并写入 <meta name="wt-build">（i18n 词典等运行时请求也带上）。
// 原因：guangqi.world 区域的 Cloudflare「浏览器缓存 TTL」会把 css/js 强制成 max-age=14400，部署后手机可能拿到新 HTML + 旧 CSS/JS（混版）。
// Pages 构建（scripts/build-pages.js）与 Render 静态服务（server.js）共用；带版本号的地址内容不可变，Service Worker 可放心长期缓存。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const h8 = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 10);
function walk(d, out = []) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (!/^(vendor|models|og|blocklist)$/.test(f.name)) walk(p, out); } else if (/\.(js|css|json|md)$/.test(f.name)) out.push(p); } return out; }
function stampHtml(html, pub) {
  const build = h8(walk(pub).sort().map(p => p + ':' + h8(fs.readFileSync(p))).join('\n'));
  html = html.replace(/(<(?:link|script)\b[^>]*?\b(?:href|src)=")([a-z0-9_\-/.]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")/gi, (m, a, f, b) => { const p = path.join(pub, f.replace(/^\//, '')); if (!p.startsWith(pub) || !fs.existsSync(p)) return m; return a + f + '?v=' + h8(fs.readFileSync(p)) + b; });
  html = html.replace(/<meta name="wt-build" content="[^"]*">/, '').replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta name="wt-build" content="${build}">`);
  return { html, build };
}
module.exports = { stampHtml };
if (require.main === module) { const pub = path.resolve(process.argv[2] || path.join(__dirname, 'public')), f = path.join(pub, 'index.html'), r = stampHtml(fs.readFileSync(f, 'utf8'), pub); fs.writeFileSync(f, r.html); console.log('stamped build', r.build); }

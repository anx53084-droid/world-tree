// 生成 26 语言 og 图：node scripts/og/gen.js（需 playwright + 本机 Noto 字体）。输出 public/og/og-<lang>.png
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const T = require('../../public/og/meta.json'), tree = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'tree.png')).toString('base64');
const out = path.join(__dirname, '../../public/og'); fs.mkdirSync(out, { recursive: true });
const html = (k, x) => `<!doctype html><html lang="${k}" dir="${x.rtl ? 'rtl' : 'ltr'}"><style>
*{margin:0}body{width:1200px;height:630px;overflow:hidden;background:radial-gradient(ellipse at 20% 30%,#1b1446,#06061a 70%);font-family:"${x.f}","Noto Sans","Noto Sans CJK SC",sans-serif}
.tree{position:absolute;right:0;top:0;width:640px;height:630px;background:url(${tree});-webkit-mask:linear-gradient(90deg,transparent,#000 22%)}
.t{position:absolute;top:0;bottom:0;left:72px;width:600px;display:flex;flex-direction:column;justify-content:center;gap:18px}
.b{color:#ffe7a3;font-size:${x.b.length > 6 ? 64 : 84}px;font-weight:800;line-height:1.1}.b small{font-size:36px;color:#f6b26b;font-weight:500;margin-inline-start:22px}
.ti{color:#fff;font-size:${x.t.length > 16 ? 46 : 54}px;font-weight:800;line-height:1.2}.u{color:#f9a8d4;font-size:${x.u.length > 34 ? 28 : 34}px;line-height:1.35}.m{color:#d6dbf5;font-size:26px}.url{position:absolute;bottom:44px;left:72px;color:#9aa3cf;font:22px "Noto Sans",sans-serif}
</style><body><div class=tree></div><div class=t><div class=b>${x.b}${x.s ? `<small>${x.s}</small>` : ''}</div><div class=ti>${x.t}</div><div class=u>${x.u}</div><div class=m>${x.m}</div></div><div class=url>guangqi.world</div></body></html>`;
(async () => { const b = await chromium.launch(process.env.WT_CHROME ? { executablePath: process.env.WT_CHROME } : {}), p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  for (const [k, x] of Object.entries(T)) { if (process.env.OG_ONLY && !process.env.OG_ONLY.split(',').includes(k)) continue; await p.setContent(html(k, x)); await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: path.join(out, `og-${k}.png`) }); }
  await b.close(); })();

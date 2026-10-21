// Cloudflare Pages 中间件：社交爬虫不执行 JS，按 ?lang= → Accept-Language → zh-CN 服务端改写 <head> 的 og/twitter/lang
import META from '../public/og/meta.json';
const LANGS = Object.keys(META); // 域名取当前请求的 origin（多域名部署，不写死）
const DEFAULT_ORIGIN = 'https://guangqi.world'; // 与 public/index.html 里静态写的首选域名一致；实际输出一律用当前请求的 origin
function match(l) { if (!l) return null; l = l.trim().toLowerCase();
  if (l.startsWith('zh')) return /tw|hk|mo|hant/.test(l) ? 'zh-TW' : 'zh-CN';
  return LANGS.find(k => k.toLowerCase() === l) || LANGS.find(k => k.toLowerCase() === l.split('-')[0]) || null; }
export function pick(url, al) { const q = match(url.searchParams.get('lang')); if (q) return q;
  if (!al) return 'zh-CN';
  const ls = al.split(',').map(s => { const [t, ...p] = s.trim().split(';'); const qv = p.find(x => x.trim().startsWith('q=')); return [t, qv ? parseFloat(qv.split('=')[1]) : 1]; }).filter(x => x[0] && x[0] !== '*').sort((a, b) => b[1] - a[1]);
  for (const [t] of ls) { const m = match(t); if (m) return m; } return ls.length ? 'en' : 'zh-CN'; }
const attr = (v) => ({ element(e) { e.setAttribute('content', v); } });
const GQN = ['星愿', '治愈', '爱', '梦想', '守护', '自由', '智慧', '家园', '创造', '重生'], GQN_TW = ['星願', '療癒', '愛', '夢想', '守護', '自由', '智慧', '家園', '創造', '重生'];
const API_DEFAULT = 'https://world-tree-ijv1.onrender.com';
// t244：/c/<卡片 id> 分享链接：爬虫拿到该卡片的 og/twitter 标签（正文、自定义封面图），浏览器立即跳转到 /#/w/<id>
async function cardPage(ctx, url, id) { const API = (ctx.env?.WT_API_BASE || API_DEFAULT).replace(/\/$/, ''), lang = pick(url, ctx.request.headers.get('accept-language')), m = META[lang];
  let c = null; try { const r = await fetch(API + '/api/og-meta/' + encodeURIComponent(id), { signal: AbortSignal.timeout(3500) }); if (r.ok) c = await r.json(); } catch {}
  const base = await (ctx.env?.ASSETS ? ctx.env.ASSETS.fetch(new URL('/', url)) : fetch(new URL('/', url)));
  const tag = c?.official ? '★ ' : c?.offchain ? '☁ ' : '', text = (c?.text || '').trim(), cn = /^zh/.test(lang) && c?.cat === '光栖' && Number.isInteger(c.cover) ? (lang === 'zh-TW' ? GQN_TW : GQN)[Math.min(9, Math.max(0, c.cover))] + '卡 · ' : '', title = text ? `${tag}「${text.length > 40 ? text.slice(0, 40) + '…' : text}」· ${cn}${m.b}` : `${m.b} · ${m.t}`;
  const gq = c?.cat === '光栖' && Number.isInteger(c.cover) ? Math.min(9, Math.max(0, c.cover)) : -1; // t248：光栖卡 → 该套卡面的分享图（与站内分享卡同风格）
  const desc = text ? `${text.slice(0, 140)} — ${m.d}` : m.d, img = c?.img ? `${API}/api/img/${c.img}` : gq >= 0 ? `${url.origin}/og/card-gq-${String(gq + 1).padStart(2, '0')}.jpg` : `${url.origin}/og/og-${lang}.png`, page = `${url.origin}/c/${encodeURIComponent(id)}`;
  const out = new HTMLRewriter()
    .on('head', { element(e) { e.prepend(`<script>location.replace('/#/w/' + ${JSON.stringify(encodeURIComponent(id))});</script>`, { html: true }); } })
    .on('html', { element(e) { e.setAttribute('lang', lang); e.setAttribute('dir', m.rtl ? 'rtl' : 'ltr'); } })
    .on('title', { element(e) { e.setInnerContent(title); } })
    .on('meta[name="description"]', attr(desc)).on('meta[property="og:title"]', attr(title)).on('meta[name="twitter:title"]', attr(title))
    .on('meta[property="og:description"]', attr(desc)).on('meta[name="twitter:description"]', attr(desc))
    .on('meta[property="og:image"]', attr(img)).on('meta[property="og:image:secure_url"]', attr(img)).on('meta[name="twitter:image"]', attr(img))
    .on('meta[property="og:image:alt"]', attr(title)).on('meta[name="twitter:image:alt"]', attr(title)).on('meta[property="og:type"]', attr('article'))
    .on('meta[property="og:url"]', attr(page)).on('link[rel="canonical"]', { element(e) { e.setAttribute('href', page); } })
    .on('meta[name="robots"]', attr(c ? 'index,follow,max-image-preview:large' : 'noindex'))
    .transform(base);
  const h = new Headers(out.headers); h.set('content-type', 'text/html; charset=utf-8'); h.set('cache-control', 'public, max-age=300'); h.append('vary', 'Accept-Language');
  return new Response(out.body, { status: 200, headers: h }); }
export async function onRequest(ctx) {
  { const u = new URL(ctx.request.url), cm = u.pathname.match(/^\/c\/([A-Za-z0-9_]{6,100})\/?$/); if (cm) return cardPage(ctx, u, cm[1]); }
  const res = await ctx.next(), url = new URL(ctx.request.url);
  if (!(res.headers.get('content-type') || '').includes('text/html') || !(url.pathname === '/' || url.pathname === '/index.html')) return res;
  const ORIGIN = url.origin, lang = pick(url, ctx.request.headers.get('accept-language')), m = META[lang];
  const rehost = { element(e) { const h = e.getAttribute('href'); if (h && h.startsWith(DEFAULT_ORIGIN)) e.setAttribute('href', ORIGIN + h.slice(DEFAULT_ORIGIN.length)); } };
  const title = `${m.b} · ${m.t}`, img = `${ORIGIN}/og/og-${lang}.png`, page = `${ORIGIN}/?lang=${lang}`;
  const out = new HTMLRewriter()
    .on('html', { element(e) { e.setAttribute('lang', lang); e.setAttribute('dir', m.rtl ? 'rtl' : 'ltr'); } })
    .on('title', { element(e) { e.setInnerContent(title); } })
    .on('meta[name="description"]', attr(m.d))
    .on('meta[property="og:title"]', attr(title)).on('meta[name="twitter:title"]', attr(title))
    .on('meta[property="og:description"]', attr(m.d)).on('meta[name="twitter:description"]', attr(m.d))
    .on('meta[property="og:image"]', attr(img)).on('meta[property="og:image:secure_url"]', attr(img)).on('meta[name="twitter:image"]', attr(img))
    .on('meta[property="og:image:alt"]', attr(`${title} — ${m.u}`)).on('meta[name="twitter:image:alt"]', attr(title))
    .on('link[rel="canonical"]', { element(e) { e.setAttribute('href', ORIGIN + '/'); } }).on('link[rel="alternate"][hreflang]', rehost)
    .on('meta[property="og:locale"]', attr(m.loc)).on('meta[property="og:url"]', attr(page))
    .transform(res);
  const h = new Headers(out.headers); h.append('vary', 'Accept-Language'); h.set('cache-control', 'public, max-age=0, must-revalidate');
  return new Response(out.body, { status: out.status, headers: h });
}

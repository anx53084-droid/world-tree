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
export async function onRequest(ctx) {
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

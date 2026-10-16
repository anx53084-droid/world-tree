// 心愿卡：商品链接预览抓取（仅 https、SSRF 防护、≤3 次重定向逐跳复查、超时、体积上限）+ 元信息提取（JSON-LD Product/Offer → og:/product: meta → <title>）
// 不做返利/联盟链接，不做购买或支付流程；价格仅为抓取时快照。
const https = require('https'), dns = require('dns'), net = require('net'), crypto = require('crypto');
const MAX_HTML = 1.5 * 1024 * 1024, MAX_IMG = 5 * 1024 * 1024, TIMEOUT = 8000, MAX_REDIR = 3;
function privIp(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19) && !process.env.GOODS_ALLOW_FAKEIP) || a >= 224; }
  const x = ip.toLowerCase(); if (x === '::' || x === '::1') return true;
  if (x.startsWith('::ffff:')) return privIp(x.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
}
function safeLookup(host, opts, cb) { // 连接时用校验过的 IP（防 DNS rebinding）
  dns.lookup(host, { all: true }, (err, addrs) => { if (err) return cb(err); const ok = addrs.filter(a => !privIp(a.address));
    if (!ok.length || ok.length !== addrs.length) return cb(Object.assign(new Error('private address'), { code: 'ssrf' }));
    if (opts && opts.all) return cb(null, ok); cb(null, ok[0].address, ok[0].family); });
}
function checkUrl(u, Block) {
  let x; try { x = new URL(u); } catch { throw Object.assign(new Error('bad url'), { code: 'goodsUrl' }); }
  if (x.protocol !== 'https:') throw Object.assign(new Error('https only'), { code: 'goodsHttps' });
  if (x.username || x.password || (x.port && x.port !== '443')) throw Object.assign(new Error('bad url'), { code: 'goodsUrl' });
  const h = x.hostname.toLowerCase(); if (!h.includes('.') || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || net.isIP(h.replace(/^\[|\]$/g, ''))) throw Object.assign(new Error('host not allowed'), { code: 'ssrf' });
  const bh = Block && Block.check(x.href); if (bh) throw Object.assign(new Error('blocked ' + bh.domain), { code: bh.type === 'shortener' ? 'blockShort' : 'blockPhish' });
  return x;
}
function get1(x, max, accept) {
  return new Promise((res, rej) => {
    const r = https.get(x, { lookup: safeLookup, timeout: TIMEOUT, headers: { 'user-agent': 'Mozilla/5.0 (compatible; WorldTreePreview/1.0; +https://guangqi.world)', accept, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' } }, s => {
      if ([301, 302, 303, 307, 308].includes(s.statusCode)) { s.resume(); return res({ redirect: s.headers.location }); }
      if (s.statusCode !== 200) { s.resume(); return rej(Object.assign(new Error('HTTP ' + s.statusCode), { code: 'goodsFetch' })); }
      const len = +s.headers['content-length'] || 0; if (len > max) { s.destroy(); return rej(Object.assign(new Error('too large'), { code: 'goodsSize' })); }
      const chunks = []; let n = 0;
      s.on('data', c => { n += c.length; if (n > max) { s.destroy(); rej(Object.assign(new Error('too large'), { code: 'goodsSize' })); } else chunks.push(c); });
      s.on('end', () => res({ buf: Buffer.concat(chunks), type: String(s.headers['content-type'] || ''), url: x.href }));
      s.on('error', rej);
    });
    r.on('timeout', () => r.destroy(Object.assign(new Error('timeout'), { code: 'goodsTimeout' }))); r.on('error', e => rej(e.code === 'ssrf' ? e : Object.assign(e, { code: e.code === 'goodsTimeout' ? e.code : (e.code === 'ssrf' ? 'ssrf' : 'goodsFetch') })));
    setTimeout(() => r.destroy(Object.assign(new Error('timeout'), { code: 'goodsTimeout' })), TIMEOUT + 2000).unref();
  });
}
async function fetchSafe(u, Block, max = MAX_HTML, accept = 'text/html,application/xhtml+xml') {
  let x = checkUrl(u, Block);
  for (let i = 0; i <= MAX_REDIR; i++) { const r = await get1(x, max, accept);
    if (!r.redirect) return r; if (i === MAX_REDIR) throw Object.assign(new Error('too many redirects'), { code: 'goodsRedir' });
    x = checkUrl(new URL(r.redirect, x).href, Block); }
}
const ent = s => String(s || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => { const k = e.toLowerCase(); if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'"; if (k === 'nbsp') return ' ';
  const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; });
const clean = (s, n) => ent(s).replace(/[\u0000-\u001f<>|~]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function decodeHtml(buf, type) { let cs = (/charset=([\w-]+)/i.exec(type) || [])[1];
  if (!cs) cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString('latin1', 0, 4096)) || [])[1];
  cs = (cs || 'utf-8').toLowerCase(); if (cs === 'gb2312' || cs === 'gbk') cs = 'gb18030';
  try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); } }
function metaMap(html) { const m = {}; for (const t of html.match(/<meta\b[^>]*>/gi) || []) {
  const k = (/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1], v = (/content\s*=\s*["']([^"']*)["']/i.exec(t) || [])[1];
  if (k && v != null && !(k.toLowerCase() in m)) m[k.toLowerCase()] = v; } return m; }
function ldProducts(html) { const out = [];
  for (const [, j] of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let d; try { d = JSON.parse(j.trim()); } catch { continue; }
    const walk = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk);
      const t = [].concat(o['@type'] || []).map(String); if (t.some(x => /^(Product|ProductGroup|IndividualProduct)$/i.test(x))) out.push(o); if (o['@graph']) walk(o['@graph']); };
    walk(d); } return out; }
const firstImg = v => typeof v === 'string' ? v : Array.isArray(v) ? firstImg(v[0]) : v && typeof v === 'object' ? (v.url || v.contentUrl || '') : '';
function offerOf(p) { let o = p.offers; if (Array.isArray(o)) o = o[0]; if (!o) return {};
  if (/AggregateOffer/i.test([].concat(o['@type'] || []).join())) return { price: o.lowPrice ?? o.price, currency: o.priceCurrency };
  const ps = o.priceSpecification; return { price: o.price ?? (Array.isArray(ps) ? ps[0]?.price : ps?.price), currency: o.priceCurrency ?? (Array.isArray(ps) ? ps[0]?.priceCurrency : ps?.priceCurrency) }; }
const normPrice = p => { if (p == null) return ''; const s = String(p).replace(/[,\s]/g, '').match(/\d+(?:\.\d{1,2})?/); return s && +s[0] > 0 && +s[0] < 1e9 ? s[0] : ''; };
const normCur = c => /^[A-Z]{3}$/.test(String(c || '').toUpperCase()) ? String(c).toUpperCase() : '';
function extract(html, base) {
  const r = { title: '', price: '', currency: '', image: '', source: [] }, m = metaMap(html);
  const P = ldProducts(html)[0];
  if (P) { r.title = clean(P.name, 80); const o = offerOf(P); r.price = normPrice(o.price); r.currency = normCur(o.currency); r.image = firstImg(P.image); r.source.push('jsonld'); }
  if (!r.title) r.title = clean(m['og:title'] || m['twitter:title'] || m['name'], 80);
  if (!r.price) r.price = normPrice(m['product:price:amount'] || m['og:price:amount'] || m['price'] || m['twitter:data1']);
  if (!r.currency) r.currency = normCur(m['product:price:currency'] || m['og:price:currency'] || m['pricecurrency'] || m['currency']);
  if (!r.image) r.image = m['og:image:secure_url'] || m['og:image'] || m['twitter:image'] || m['image'] || '';
  if (m['og:title'] || m['product:price:amount']) r.source.push('meta');
  if (!r.title) { r.title = clean((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1], 80); if (r.title) r.source.push('title'); }
  if (!r.price) { const g = /(?:["']price["']\s*:\s*["']?|class=["'][^"']*price[^"']*["'][^>]*>\s*[¥￥$€£]?\s*)(\d[\d,]*(?:\.\d{1,2})?)/i.exec(html); if (g) { r.price = normPrice(g[1]); if (r.price) r.source.push('heuristic'); } }
  if (/^(京东\(JD\.COM\)-正品低价|淘宝网 - 淘！我喜欢|天猫tmall\.com|Amazon\.com\s*$|Products$|Access Denied|Just a moment|Robot Check|安全验证|验证码)/i.test(r.title)) { r.title = ''; r.source.push('generic'); } // 登录墙/风控页
  if (r.image) try { r.image = new URL(ent(r.image), base).href; } catch { r.image = ''; }
  return r;
}
function productKey(u) { // 链上紧凑标识：域名 + 商品 ID（已知平台）或 URL 哈希
  const x = new URL(u), host = x.hostname.toLowerCase().replace(/^(www|m|item|detail|h5)\./, ''), q = x.searchParams, p = x.pathname;
  let id = (/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(p) || [])[1] // Amazon
    || (/(?:jd\.com|jd\.hk)$/.test(host) && (/\/(\d{5,20})\.html/.exec(p) || [])[1]) // JD
    || ((/(taobao|tmall)\.com$/.test(host)) && /^\d{5,20}$/.test(q.get('id') || '') && q.get('id')) // Taobao/Tmall
    || (/\/(?:item|itm|product|products|p)\/([\w-]{3,40})/i.exec(p) || [])[1] || '';
  id = String(id || '').replace(/[^\w-]/g, '').slice(0, 24);
  if (!id) id = 'h' + crypto.createHash('sha256').update(x.origin + p + (q.toString() ? '?' + q.toString() : '')).digest('hex').slice(0, 12);
  return { domain: host.slice(0, 40), pid: id };
}
module.exports = { privIp, checkUrl, fetchSafe, extract, productKey, normPrice, normCur, clean, decodeHtml, MAX_IMG };

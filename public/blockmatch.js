// 钓鱼 / 短链黑名单匹配（前后端共用，UMD）。域名按“自身或任一父域”匹配：evil.bit.ly → bit.ly
(function (root, f) { const m = f(); if (typeof module === 'object' && module.exports) module.exports = m; else root.WTBlock = m; })(typeof self !== 'undefined' ? self : this, function () {
  // 文本规范化：全角/中文句点、[.]/(.)/" dot " 等混淆写法、零宽字符
  const norm = s => String(s || '').normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/[。．｡︒]/g, '.').replace(/\s*[\[\(\{]\s*(\.|dot|点)\s*[\]\)\}]\s*/gi, '.').replace(/\s+(dot|点)\s+/gi, '.').toLowerCase();
  const HOST = /(?:[a-z][a-z0-9+.-]*:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59}))(?![a-z0-9-])/g;
  function hosts(text) { const out = new Set(), t = norm(text); for (const m of t.matchAll(HOST)) out.add(m[1].replace(/^www\d*\./, '')); return [...out]; }
  const ADDR = /\b0x[0-9a-f]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  const make = j => ({ domains: new Set(j?.domains || []), shorteners: new Set(j?.shorteners || []), addresses: new Set((j?.addresses || []).map(a => /^0x/i.test(a) ? a.toLowerCase() : a)), sigs: new Set(j?.sigs || []), updatedAt: j?.updatedAt || null });
  function hitHost(B, h) { for (let x = h; x && x.includes('.'); x = x.slice(x.indexOf('.') + 1)) { if (B.shorteners.has(x)) return { type: 'shortener', domain: x }; if (B.domains.has(x)) return { type: 'phishing', domain: x }; } return null; }
  const addrHit = (B, a) => !!a && B.addresses.has(/^0x/i.test(a) ? a.toLowerCase() : a);
  function checkText(B, text) { if (!B || !text) return null; for (const h of hosts(text)) { const r = hitHost(B, h); if (r) return r; }
    for (const m of String(text).matchAll(ADDR)) if (addrHit(B, m[0])) return { type: 'address', domain: m[0] }; return null; }
  const maybeHasHost = text => HOST.test(norm(text)) && !(HOST.lastIndex = 0); // 快速判断：文本里是否像有域名（决定是否需要加载完整域名表）
  return { norm, hosts, make, hitHost, addrHit, checkText, maybeHasHost };
});

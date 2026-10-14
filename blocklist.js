// 服务器端黑名单（权威）：启动时读 public/blocklist.json，随后从 Pages 拉取最新版（ETag），每日刷新
const fs = require('fs'), path = require('path'), W = require('./public/blockmatch.js');
const URL_ = process.env.BLOCKLIST_URL || 'https://world-tree.pages.dev/blocklist.json', FILE = path.join(__dirname, 'public', 'blocklist.json');
let B = W.make(null), etag = null, src = 'none';
function setFrom(j, from) { const nb = W.make(j); if (B.domains.size && nb.domains.size < B.domains.size * 0.5) return console.warn('blocklist: refusing shrink', B.domains.size, '→', nb.domains.size); B = nb; src = from; console.log(`blocklist: ${from} domains=${B.domains.size} shorteners=${B.shorteners.size} addresses=${B.addresses.size} (${j.updatedAt})`); }
try { setFrom(JSON.parse(fs.readFileSync(FILE, 'utf8')), 'file'); } catch (e) { console.warn('blocklist: no local file', e.message); }
async function refresh() { try { const r = await fetch(URL_, { headers: etag ? { 'if-none-match': etag } : {}, signal: AbortSignal.timeout(60000) }); if (r.status === 304) return;
    if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); if (B.updatedAt && j.updatedAt && j.updatedAt <= B.updatedAt) { etag = r.headers.get('etag'); return; } setFrom(j, 'remote'); etag = r.headers.get('etag'); } catch (e) { console.warn('blocklist refresh failed:', e.message); } }
setTimeout(refresh, 5000); setInterval(refresh, 24 * 3600e3).unref();
module.exports = { check: text => W.checkText(B, text), addrBlocked: a => W.addrHit(B, a), sigBlocked: s => B.sigs.has(s), info: () => ({ src, updatedAt: B.updatedAt, domains: B.domains.size, shorteners: B.shorteners.size, addresses: B.addresses.size, sigs: B.sigs.size }) };

// 币价（USD）：SOL / ETH / BNB。多源（Coinbase / Binance / CoinGecko）取中位数，缓存 60 秒；全部失败则回退最近一次成功值并标记 stale。
// 前端只读 GET /api/prices，不直连第三方；团购礼品卡的支付校验使用这里的服务端报价（并在创建订单时锁价）。
const fs = require('fs'), path = require('path');
const COINS = ['SOL', 'ETH', 'BNB'], TTL = 60000, RETRY = 10000, CG = { SOL: 'solana', ETH: 'ethereum', BNB: 'binancecoin' };
const FB = { SOL: +process.env.SOL_USD || 150, ETH: +process.env.ETH_USD || 3000, BNB: +process.env.BNB_USD || 600 }; // 仅当从未成功取价时的兜底（总是 stale，团购报价会拒绝使用）
const j = async url => (await fetch(url, { signal: AbortSignal.timeout(3000) })).json();
// 每个源返回 { SOL, ETH, BNB } 的子集；某个源失败不影响其它源
const sources = {
  coinbase: async () => { const o = {}; await Promise.all(COINS.map(async c => { try { o[c] = +(await j(`https://api.coinbase.com/v2/prices/${c}-USD/spot`)).data.amount; } catch {} })); return o; },
  binance: async () => { const o = {}; await Promise.all(COINS.map(async c => { try { o[c] = +(await j(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${c}USDT`)).price; } catch {} })); return o; },
  coingecko: async () => { const r = await j('https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,binancecoin&vs_currencies=usd'), o = {}; for (const c of COINS) o[c] = +r[CG[c]]?.usd; return o; } };
const median = a => { a = a.filter(x => Number.isFinite(x) && x > 0).sort((x, y) => x - y); if (!a.length) return 0; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
let cache = null, last = null, inflight = null; const state = { sources };
async function fetchAll(now) { const res = await Promise.all(Object.entries(state.sources).map(async ([n, f]) => { try { return [n, await f()]; } catch { return [n, {}]; } }));
  const price = {}, used = {}, stale = {}; let any = false;
  for (const c of COINS) { const vs = res.map(([n, o]) => [n, +o[c]]).filter(([, v]) => Number.isFinite(v) && v > 0); const m = median(vs.map(x => x[1]));
    if (m) { price[c] = m; used[c] = vs.map(x => x[0]); stale[c] = false; any = true; } else if (last?.price[c]) { price[c] = last.price[c]; used[c] = []; stale[c] = true; } else { price[c] = FB[c]; used[c] = []; stale[c] = true; } }
  const r = { price, sources: used, stale, at: now, live: COINS.reduce((o, c) => (o[c] = stale[c] ? (last?.live?.[c] || 0) : now, o), {}) }; // live[c]：该币上次真实取价的时间
  if (any) last = { price: { ...(last?.price || {}), ...Object.fromEntries(COINS.filter(c => !stale[c]).map(c => [c, price[c]])) }, live: { ...(last?.live || {}), ...Object.fromEntries(COINS.filter(c => !stale[c]).map(c => [c, now])) } };
  r.live = { ...(last?.live || {}) }; return r; }
// 测试：PRICE_MOCK=1 时读取 data/prices-mock.json（{SOL,ETH,BNB}），不访问网络
const mock = () => { try { const o = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'prices-mock.json'), 'utf8')), now = Date.now(); return { price: { SOL: +o.SOL, ETH: +o.ETH, BNB: +o.BNB }, sources: { SOL: ['mock'], ETH: ['mock'], BNB: ['mock'] }, stale: { SOL: !!o.stale, ETH: !!o.stale, BNB: !!o.stale }, at: now, live: { SOL: o.stale ? now - 3600000 : now, ETH: o.stale ? now - 3600000 : now, BNB: o.stale ? now - 3600000 : now } }; } catch { return null; } };
async function get(now = Date.now()) { if (process.env.PRICE_MOCK === '1') { const m = mock(); if (m) return view(m, now); }
  if (cache && now - cache.at < (cache.failed ? RETRY : TTL)) return view(cache, now);
  inflight ||= fetchAll(now).then(r => { cache = { ...r, failed: COINS.some(c => r.stale[c]) }; return cache; }).finally(() => { inflight = null; }); return view(await inflight, now); }
const view = (c, now) => ({ prices: { ...c.price }, at: c.at, stale: COINS.some(x => c.stale[x]), staleCoins: COINS.filter(x => c.stale[x]), sources: c.sources, ageSec: Math.round((now - c.at) / 1000), liveAt: c.live || {} });
// 团购报价是否可用：该币必须有 15 分钟内的真实取价（回退常量永不可用）
const usable = (v, coin, now = Date.now(), maxAge = 15 * 60000) => { const t = v.liveAt?.[coin] || 0; return v.prices[coin] > 0 && t > 0 && now - t <= maxAge; };
const reset = () => { cache = last = inflight = null; };
module.exports = { COINS, get, usable, median, state, reset };

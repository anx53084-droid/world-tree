// 服务器端开源 NSFW 图片分类（nsfwjs MobileNetV2 + 纯 JS @tensorflow/tfjs，sharp 解码），懒加载；无需外部账号
// 判定：Porn ≥ .5、Hentai ≥ .5、Sexy ≥ .7、或 Porn+Hentai+Sexy ≥ .85 即拒绝（可用 NSFW_T_PORN / NSFW_T_HENTAI / NSFW_T_SEXY 覆盖）
const T = { Porn: +process.env.NSFW_T_PORN || .5, Hentai: +process.env.NSFW_T_HENTAI || .5, Sexy: +process.env.NSFW_T_SEXY || .7, sum: .85 };
let modelP = null, tf = null;
function load() { if (!modelP) modelP = (async () => { tf = require('@tensorflow/tfjs'); await tf.setBackend('cpu'); await tf.ready(); tf.enableProdMode();
  const nsfw = require('nsfwjs'); const t0 = Date.now(); const m = await nsfw.load('MobileNetV2'); console.log(`nsfw model loaded in ${Date.now() - t0}ms, rss ${Math.round(process.memoryUsage().rss / 1e6)}MB`); return m; })().catch(e => { modelP = null; throw e; });
  return modelP; }
function decide(p) { const s = (p.Porn || 0) + (p.Hentai || 0) + (p.Sexy || 0);
  const hit = ['Porn', 'Hentai', 'Sexy'].find(k => (p[k] || 0) >= T[k]) || (s >= T.sum ? 'sum' : null); return { pass: !hit, hit }; }
async function classify(buf) { const m = await load(), sharp = require('sharp');
  const { data, info } = await sharp(buf).removeAlpha().resize(224, 224, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const x = tf.tensor3d(new Int32Array(data), [info.height, info.width, 3], 'int32'); try { const r = await m.classify(x); return Object.fromEntries(r.map(o => [o.className, +o.probability.toFixed(4)])); } finally { x.dispose(); } }
let q = Promise.resolve(); // 串行化，避免并发推理导致内存峰值
async function check(buf) { const run = q.then(() => check1(buf)); q = run.catch(() => {}); return run; }
async function check1(buf) { const p = await classify(buf); return { ...decide(p), scores: p, provider: 'nsfwjs' }; }
module.exports = { check, classify, decide, load, T };

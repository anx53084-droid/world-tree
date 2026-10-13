// 服务器端开源 NSFW 图片分类（nsfwjs MobileNetV2 + 纯 JS @tensorflow/tfjs，sharp 解码）
// 在 worker_thread 中懒加载与推理：不阻塞主事件循环（Render 免费实例 CPU 很弱），且限制 worker 堆内存，崩溃只影响 worker（主进程判为失败并拒绝）
// 判定：Porn ≥ .5、Hentai ≥ .5、Sexy ≥ .7、或三者之和 ≥ .85 即拒绝（NSFW_T_PORN / NSFW_T_HENTAI / NSFW_T_SEXY 可覆盖）
const { Worker, isMainThread, parentPort } = require('worker_threads');
const T = { Porn: +process.env.NSFW_T_PORN || .5, Hentai: +process.env.NSFW_T_HENTAI || .5, Sexy: +process.env.NSFW_T_SEXY || .7, sum: .85 };
function decide(p) { const s = (p.Porn || 0) + (p.Hentai || 0) + (p.Sexy || 0);
  const hit = ['Porn', 'Hentai', 'Sexy'].find(k => (p[k] || 0) >= T[k]) || (s >= T.sum ? 'sum' : null); return { pass: !hit, hit }; }
if (!isMainThread) { // ---- worker ----
  // 模型以 model.json + weights.bin 随仓库提供（由 nsfwjs 自带的 MobileNetV2 转出）：避免引入 nsfwjs 的 JS 打包模型（含 30MB InceptionV3，内存会爆）
  let mP = null, tf;
  async function loadModel() { tf = require('@tensorflow/tfjs'); await tf.setBackend('cpu'); await tf.ready(); tf.enableProdMode(); const t0 = Date.now();
    const fs = require('fs'), D = require('path').join(__dirname, 'models', 'nsfw'), j = JSON.parse(fs.readFileSync(D + '/model.json')), w = fs.readFileSync(D + '/weights.bin');
    const h = tf.io.fromMemory({ modelTopology: j.modelTopology, weightSpecs: j.weightsManifest.flatMap(x => x.weights), weightData: w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength) });
    const m = await require('nsfwjs/core').load(h, { size: 224 });
    // 自检：权重损坏时输出近似均匀分布（每类 .2），此时判为不可用（fail closed）
    const z = await m.classify(tf.zeros([224, 224, 3], 'int32')); if (Math.max(...z.map(o => o.probability)) < .3) throw new Error('nsfw model self-test failed');
    console.log(`nsfw model loaded in ${Date.now() - t0}ms`); return m; }
  const load = () => mP ||= loadModel().catch(e => { mP = null; throw e; });
  parentPort.on('message', async ({ id, buf }) => { try { const m = await load(), sharp = require('sharp');
      const { data, info } = await sharp(Buffer.from(buf)).removeAlpha().resize(224, 224, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      const x = tf.tensor3d(new Int32Array(data), [info.height, info.width, 3], 'int32'); let r; try { r = await m.classify(x); } finally { x.dispose(); }
      parentPort.postMessage({ id, scores: Object.fromEntries(r.map(o => [o.className, +o.probability.toFixed(4)])) }); }
    catch (e) { parentPort.postMessage({ id, error: String(e && e.message || e) }); } });
} else { // ---- main ----
  let w = null, seq = 0; const wait = new Map();
  const worker = () => { if (w) return w; w = new Worker(__filename, { resourceLimits: { maxOldGenerationSizeMb: 320 } });
    w.on('message', m => { const p = wait.get(m.id); if (p) { wait.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.scores); } });
    const dead = e => { console.warn('nsfw worker exited', e?.message || e); for (const p of wait.values()) p.rej(new Error('nsfw worker crashed')); wait.clear(); w = null; };
    w.on('error', dead); w.on('exit', c => c && dead('code ' + c)); return w; };
  const TIMEOUT = +process.env.NSFW_TIMEOUT_MS || 180000; // 冷启动（加载模型）在 0.1 CPU 上可能较慢
  let q = Promise.resolve();
  const classify1 = buf => new Promise((res, rej) => { const id = ++seq, t = setTimeout(() => { wait.delete(id); rej(new Error('nsfw timeout')); }, TIMEOUT); wait.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } }); worker().postMessage({ id, buf }); });
  const classify = buf => { const r = q.then(() => classify1(buf)); q = r.catch(() => {}); return r; }; // 串行，避免并发推理内存峰值
  module.exports = { decide, T, classify, async check(buf) { const p = await classify(buf); return { ...decide(p), scores: p, provider: 'nsfwjs' }; }, warm: () => worker() };
}

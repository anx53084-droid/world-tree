// CSS Paint Worklet：星空背景。最多 180 颗星，密度上限 2.5，按元素尺寸确定性播种
class Starfield {
  static get inputProperties() { return ['--star-density']; }
  paint(ctx, size, props) {
    const density = Math.min(2.5, Math.max(0, parseFloat(props.get('--star-density')) || 1));
    const count = Math.min(180, Math.floor((size.width * size.height) / 12000 * density));
    if (count <= 0) return;
    let s = (Math.floor(size.width) * 73856093 ^ Math.floor(size.height) * 19349663) >>> 0 || 1;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < count; i++) {
      const x = rnd() * size.width, y = rnd() * size.height, r = rnd() * 1.4 + 0.3;
      ctx.fillStyle = `rgba(255,255,${200 + Math.floor(rnd() * 55)},${(0.3 + rnd() * 0.7).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}
registerPaint('starfield', Starfield);

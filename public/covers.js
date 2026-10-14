// 内置封面插画（程序化 canvas 绘制，无外部资源）：6 类 × 3 张。WTCovers.draw(ctx, id, w, h)
(function () {
  const L = [['风景', 'mountain'], ['风景', 'sea'], ['风景', 'forest'], ['人物', 'couple'], ['人物', 'balloon'], ['人物', 'reader'], ['动物', 'cat'], ['动物', 'koi'], ['动物', 'cranes'],
    ['卡通', 'sun'], ['卡通', 'rainbow'], ['卡通', 'rocket'], ['经典', 'clouds'], ['经典', 'lantern'], ['经典', 'plum'], ['物质类', 'gift'], ['物质类', 'house'], ['物质类', 'gem'],
    // 卡片封面设计预设（id 18+，追加在末尾保证旧卡 id 不变）
    ['自然', 'sakura'], ['自然', 'woods'], ['自然', 'starry'], ['自然', 'ocean'], ['自然', 'peaks'], ['简约', 'gradient'], ['简约', 'lines'], ['简约', 'halo'], ['情感', 'warm'], ['情感', 'hope'], ['情感', 'calm'], ['情感', 'party']];
  const lg = (x, h, stops) => { const g = x.createLinearGradient(0, 0, 0, h); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; };
  const circ = (x, cx, cy, r, c) => { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
  const poly = (x, pts, c) => { x.fillStyle = c; x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); x.fill(); };
  function rnd(s) { return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  const P = {
    sakura(x, w, h) { x.fillStyle = lg(x, h, ['#ffd9e6', '#f7b6cf', '#c98bb9']); x.fillRect(0, 0, w, h); const r = rnd(11);
      x.strokeStyle = '#6b3f4f'; x.lineWidth = w * .03; x.lineCap = 'round'; x.beginPath(); x.moveTo(-w * .05, h * .2); x.quadraticCurveTo(w * .4, h * .25, w * .7, h * .05); x.moveTo(w * .25, h * .22); x.lineTo(w * .35, h * .4); x.stroke();
      for (let i = 0; i < 26; i++) { const cx = r() * w, cy = r() * h * .5, s = w * (.03 + r() * .03); x.save(); x.translate(cx, cy); for (let k = 0; k < 5; k++) { x.rotate(1.2566); circ(x, 0, s * .8, s * .6, '#fff0f5'); } circ(x, 0, 0, s * .3, '#f48fb1'); x.restore(); }
      for (let i = 0; i < 18; i++) { x.fillStyle = '#ffffffcc'; x.beginPath(); x.ellipse(r() * w, h * (.5 + r() * .5), w * .015, w * .008, r() * 3, 0, 7); x.fill(); } },
    woods(x, w, h) { x.fillStyle = lg(x, h, ['#e8f5d0', '#9ccf8a', '#2f6b45']); x.fillRect(0, 0, w, h); const r = rnd(5);
      for (let l = 0; l < 3; l++) for (let i = 0; i < 7; i++) { const cx = w * (i / 6) + (r() - .5) * w * .1, b = h * (.55 + l * .17), tt = b - h * (.28 - l * .04); poly(x, [[cx, tt], [cx + w * .1, b], [cx - w * .1, b]], ['#5a9a68', '#3c7a52', '#24563a'][l]); }
      x.fillStyle = '#1d4430'; x.fillRect(0, h * .9, w, h); x.fillStyle = '#fff6'; for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(w * (.2 + i * .15), 0); x.lineTo(w * (.1 + i * .15), h); x.lineTo(w * (.13 + i * .15), h); x.closePath(); x.globalAlpha = .12; x.fill(); } x.globalAlpha = 1; },
    starry(x, w, h) { x.fillStyle = lg(x, h, ['#050824', '#1b1f5c', '#4b2a73']); x.fillRect(0, 0, w, h); const r = rnd(9);
      for (let i = 0; i < 120; i++) circ(x, r() * w, r() * h, r() * 1.4 + .3, `rgba(255,255,${200 + (r() * 55 | 0)},${.4 + r() * .6})`);
      x.save(); x.translate(w * .5, h * .45); x.rotate(-.5); const g = x.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, '#0000'); g.addColorStop(.5, '#b9a6ff55'); g.addColorStop(1, '#0000'); x.fillStyle = g; x.fillRect(-w, -h * .08, 2 * w, h * .16); x.restore();
      circ(x, w * .78, h * .16, w * .06, '#fff8d6'); circ(x, w * .81, h * .14, w * .055, '#1b1f5c'); },
    ocean(x, w, h) { x.fillStyle = lg(x, h, ['#bfe9ff', '#7cc6ee', '#ffe1b8']); x.fillRect(0, 0, w, h * .5); circ(x, w * .5, h * .5, w * .16, '#fff1c4');
      for (let i = 0; i < 6; i++) { x.fillStyle = ['#4aa3d8', '#3890c8', '#2b7cb6', '#2169a2', '#18568c', '#104476'][i]; x.beginPath(); const y = h * (.5 + i * .085); x.moveTo(0, y); for (let k = 0; k <= 8; k++) x.quadraticCurveTo(w * (k - .5) / 8, y - h * .02, w * k / 8, y); x.lineTo(w, h); x.lineTo(0, h); x.fill(); } },
    peaks(x, w, h) { x.fillStyle = lg(x, h, ['#cfe3ff', '#e9eefc', '#ffffff']); x.fillRect(0, 0, w, h);
      [['#9fb3d9', .5, .25], ['#6f86b8', .62, .35], ['#3f5487', .76, .45]].forEach(([c, b, a], j) => { x.fillStyle = c; x.beginPath(); x.moveTo(0, h * b); for (let k = 0; k <= 4; k++) x.lineTo(w * (k / 4), h * (b - (k % 2 ? a * .6 : 0)) + j * 4); x.lineTo(w, h); x.lineTo(0, h); x.fill(); });
      poly(x, [[w * .25, h * .35], [w * .3, h * .4], [w * .2, h * .4]], '#fff'); poly(x, [[w * .75, h * .35], [w * .8, h * .4], [w * .7, h * .4]], '#fff'); },
    gradient(x, w, h) { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#7f7fd5'); g.addColorStop(.5, '#86a8e7'); g.addColorStop(1, '#91eae4'); x.fillStyle = g; x.fillRect(0, 0, w, h); },
    lines(x, w, h) { x.fillStyle = '#f6f3ee'; x.fillRect(0, 0, w, h); x.strokeStyle = '#2b2b2b'; x.lineWidth = Math.max(1, w / 120);
      for (let i = 0; i < 7; i++) { x.beginPath(); x.moveTo(0, h * (.3 + i * .07)); x.bezierCurveTo(w * .3, h * (.2 + i * .07), w * .7, h * (.45 + i * .07), w, h * (.32 + i * .07)); x.globalAlpha = .15 + i * .1; x.stroke(); } x.globalAlpha = 1; circ(x, w * .72, h * .2, w * .07, '#e76f51'); },
    halo(x, w, h) { x.fillStyle = '#0d0b26'; x.fillRect(0, 0, w, h); const g = x.createRadialGradient(w * .5, h * .45, 0, w * .5, h * .45, w * .6); g.addColorStop(0, '#fff5d6'); g.addColorStop(.25, '#ffc77a'); g.addColorStop(.55, '#b4569e55'); g.addColorStop(1, '#0000'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#ffe9b080'; x.lineWidth = 1.5; [.3, .42].forEach(r => { x.beginPath(); x.arc(w * .5, h * .45, w * r, 0, 7); x.stroke(); }); },
    warm(x, w, h) { x.fillStyle = lg(x, h, ['#ffcf99', '#ff9e7a', '#c75f6a']); x.fillRect(0, 0, w, h); circ(x, w * .5, h * .78, w * .5, '#ffe2b8');
      const hp = (cx, cy, s, c) => { x.fillStyle = c; x.beginPath(); x.moveTo(cx, cy + s * .35); x.bezierCurveTo(cx - s, cy - s * .4, cx - s * .4, cy - s, cx, cy - s * .4); x.bezierCurveTo(cx + s * .4, cy - s, cx + s, cy - s * .4, cx, cy + s * .35); x.fill(); };
      hp(w * .5, h * .45, w * .26, '#e2445c'); hp(w * .25, h * .2, w * .08, '#fff4'); hp(w * .8, h * .28, w * .06, '#fff5'); },
    hope(x, w, h) { x.fillStyle = lg(x, h, ['#1e2a5e', '#e48f6a', '#ffd88a']); x.fillRect(0, 0, w, h); circ(x, w * .5, h * .7, w * .2, '#fff3c4');
      x.strokeStyle = '#fff3c455'; x.lineWidth = w * .015; for (let i = 0; i < 12; i++) { const a = Math.PI + i * Math.PI / 11; x.beginPath(); x.moveTo(w * .5 + Math.cos(a) * w * .25, h * .7 + Math.sin(a) * w * .25); x.lineTo(w * .5 + Math.cos(a) * w * .6, h * .7 + Math.sin(a) * w * .6); x.stroke(); }
      x.fillStyle = '#2b2440'; x.fillRect(0, h * .72, w, h); x.fillStyle = '#4caf50'; x.fillRect(w * .48, h * .6, w * .04, h * .12); circ(x, w * .45, h * .6, w * .05, '#7ed36b'); circ(x, w * .55, h * .58, w * .05, '#7ed36b'); },
    calm(x, w, h) { x.fillStyle = lg(x, h, ['#dfe9f3', '#b8cde0', '#8fb0c9']); x.fillRect(0, 0, w, h); x.fillStyle = '#ffffff99'; [[.3, .25], [.7, .18]].forEach(([a, b]) => { x.beginPath(); x.ellipse(w * a, h * b, w * .18, h * .03, 0, 0, 7); x.fill(); });
      x.fillStyle = '#7f9fbb'; x.fillRect(0, h * .62, w, h); x.strokeStyle = '#dfe9f3aa'; x.lineWidth = 1.5; for (let i = 0; i < 4; i++) { x.beginPath(); x.ellipse(w * .5, h * .72, w * (.1 + i * .08), h * (.015 + i * .012), 0, 0, 7); x.stroke(); }
      poly(x, [[w * .2, h * .62], [w * .35, h * .48], [w * .5, h * .62]], '#6d8aa6'); },
    party(x, w, h) { x.fillStyle = lg(x, h, ['#2a1b5c', '#5b2a86', '#b33f8c']); x.fillRect(0, 0, w, h); const r = rnd(21), C = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#fff'];
      for (let i = 0; i < 60; i++) { x.save(); x.translate(r() * w, r() * h); x.rotate(r() * 6); x.fillStyle = C[i % 5]; x.fillRect(0, 0, w * .03, w * .012); x.restore(); }
      [[.3, .35, '#ffd166'], [.68, .3, '#ef476f']].forEach(([a, b, c]) => { for (let k = 0; k < 16; k++) { const an = k * Math.PI / 8; x.strokeStyle = c; x.lineWidth = 2; x.beginPath(); x.moveTo(w * a + Math.cos(an) * w * .03, h * b + Math.sin(an) * w * .03); x.lineTo(w * a + Math.cos(an) * w * .13, h * b + Math.sin(an) * w * .13); x.stroke(); } }); },

    mountain(x, w, h) { x.fillStyle = lg(x, h, ['#f6b07a', '#e9879a', '#7d5a9e']); x.fillRect(0, 0, w, h); circ(x, w * .68, h * .38, w * .13, '#fff1c9');
      poly(x, [[0, h * .72], [w * .28, h * .42], [w * .5, h * .66], [w * .72, h * .36], [w, h * .62], [w, h], [0, h]], '#5b3f73'); poly(x, [[w * .28, h * .42], [w * .34, h * .5], [w * .22, h * .5]], '#f4e6f0');
      poly(x, [[0, h * .84], [w * .4, h * .7], [w, h * .82], [w, h], [0, h]], '#3a2852'); },
    sea(x, w, h) { x.fillStyle = lg(x, h, ['#1d2a5a', '#3f5d9a', '#9db7d8']); x.fillRect(0, 0, w, h * .6); circ(x, w * .5, h * .3, w * .12, '#fdf5d8');
      x.fillStyle = lg(x, h, ['#2c4f86', '#163061']); x.fillRect(0, h * .6, w, h * .4); x.strokeStyle = '#fdf5d8aa'; for (let i = 0; i < 9; i++) { x.lineWidth = 2; const y = h * (.63 + i * .04); x.beginPath(); x.moveTo(w * (.5 - .05 - i * .02), y); x.lineTo(w * (.5 + .05 + i * .02), y); x.stroke(); } },
    forest(x, w, h) { x.fillStyle = lg(x, h, ['#0f1838', '#2a3d6b', '#4a6b7c']); x.fillRect(0, 0, w, h); const r = rnd(3); for (let i = 0; i < 40; i++) circ(x, r() * w, r() * h * .5, r() * 1.6 + .4, '#fff');
      for (let i = 0; i < 9; i++) { const cx = w * (i / 8), b = h * (.78 + r() * .1), t = b - h * (.25 + r() * .2); poly(x, [[cx, t], [cx + w * .09, b], [cx - w * .09, b]], i % 2 ? '#1e3b3a' : '#16302f'); } x.fillStyle = '#122624'; x.fillRect(0, h * .85, w, h); },
    couple(x, w, h) { x.fillStyle = lg(x, h, ['#2b1f4f', '#8a4f8c', '#f2a7a0']); x.fillRect(0, 0, w, h); circ(x, w * .5, h * .42, w * .26, '#ffe6c6');
      [[.42, '#2b1a3a'], [.58, '#2b1a3a']].forEach(([px, c]) => { circ(x, w * px, h * .52, w * .045, c); poly(x, [[w * px - w * .06, h * .78], [w * px, h * .56], [w * px + w * .06, h * .78]], c); }); x.fillStyle = '#2b1a3a'; x.fillRect(0, h * .78, w, h); circ(x, w * .5, h * .6, w * .02, '#ff7a9a'); },
    balloon(x, w, h) { x.fillStyle = lg(x, h, ['#8fd3f4', '#c4e8f7', '#fdf2d6']); x.fillRect(0, 0, w, h); x.strokeStyle = '#555'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(w * .5, h * .4); x.quadraticCurveTo(w * .46, h * .55, w * .52, h * .66); x.stroke();
      x.fillStyle = '#ff5f7e'; x.beginPath(); x.ellipse(w * .5, h * .3, w * .12, h * .1, 0, 0, 7); x.fill(); circ(x, w * .52, h * .7, w * .04, '#3b3b5c'); poly(x, [[w * .46, h * .9], [w * .52, h * .73], [w * .58, h * .9]], '#3b3b5c'); x.fillStyle = '#9ccc65'; x.fillRect(0, h * .9, w, h); },
    reader(x, w, h) { x.fillStyle = lg(x, h, ['#f7e3c3', '#e8c39a']); x.fillRect(0, 0, w, h); circ(x, w * .5, h * .38, w * .12, '#6b4a3a'); x.fillStyle = '#c0573e'; x.beginPath(); x.ellipse(w * .5, h * .72, w * .26, h * .2, 0, Math.PI, 0); x.fill();
      poly(x, [[w * .3, h * .62], [w * .5, h * .66], [w * .7, h * .62], [w * .7, h * .74], [w * .5, h * .78], [w * .3, h * .74]], '#fffaf0'); x.fillStyle = '#c69c6d'; x.fillRect(0, h * .84, w, h); },
    cat(x, w, h) { x.fillStyle = lg(x, h, ['#1b2350', '#3c3f7c']); x.fillRect(0, 0, w, h); circ(x, w * .72, h * .25, w * .11, '#fbeec1'); x.fillStyle = '#2a1f2e'; x.fillRect(0, h * .74, w, h);
      x.beginPath(); x.ellipse(w * .45, h * .66, w * .14, h * .1, 0, 0, 7); x.fill(); circ(x, w * .45, h * .5, w * .09, '#2a1f2e'); poly(x, [[w * .38, h * .46], [w * .4, h * .38], [w * .44, h * .44]], '#2a1f2e'); poly(x, [[w * .46, h * .44], [w * .5, h * .38], [w * .52, h * .46]], '#2a1f2e');
      x.strokeStyle = '#2a1f2e'; x.lineWidth = w * .03; x.beginPath(); x.moveTo(w * .58, h * .7); x.quadraticCurveTo(w * .72, h * .7, w * .68, h * .56); x.stroke(); circ(x, w * .42, h * .5, 2, '#f7d24a'); circ(x, w * .48, h * .5, 2, '#f7d24a'); },
    koi(x, w, h) { x.fillStyle = lg(x, h, ['#2f7e8c', '#1a4f6b']); x.fillRect(0, 0, w, h); const f = (cx, cy, a, c) => { x.save(); x.translate(cx, cy); x.rotate(a); x.fillStyle = c; x.beginPath(); x.ellipse(0, 0, w * .16, h * .045, 0, 0, 7); x.fill();
      poly(x, [[-w * .15, 0], [-w * .24, -h * .04], [-w * .24, h * .04]], c); circ(x, w * .03, -h * .01, w * .03, '#fff'); x.restore(); }; f(w * .4, h * .4, .5, '#ff7b39'); f(w * .62, h * .66, -2.4, '#fbf3e6');
      x.strokeStyle = '#ffffff40'; x.lineWidth = 1.5; [[.3, .7], [.7, .3]].forEach(([a, b]) => { x.beginPath(); x.arc(w * a, h * b, w * .08, 0, 7); x.stroke(); }); circ(x, w * .2, h * .2, w * .07, '#5fae6a'); },
    cranes(x, w, h) { x.fillStyle = lg(x, h, ['#fde8d0', '#f5c4a8']); x.fillRect(0, 0, w, h); circ(x, w * .5, h * .35, w * .2, '#e8513b');
      const b = (cx, cy, s) => { x.strokeStyle = '#2b2b2b'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - s, cy); x.quadraticCurveTo(cx - s * .4, cy - s * .6, cx, cy); x.quadraticCurveTo(cx + s * .4, cy - s * .6, cx + s, cy); x.stroke(); };
      b(w * .3, h * .6, w * .1); b(w * .55, h * .68, w * .07); b(w * .72, h * .56, w * .06); poly(x, [[0, h * .86], [w * .35, h * .78], [w * .7, h * .84], [w, h * .8], [w, h], [0, h]], '#6c8a8f'); },
    sun(x, w, h) { x.fillStyle = lg(x, h, ['#7fd0ff', '#d7f0ff']); x.fillRect(0, 0, w, h); x.strokeStyle = '#ffb300'; x.lineWidth = 5; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; x.beginPath(); x.moveTo(w * .5 + Math.cos(a) * w * .2, h * .4 + Math.sin(a) * w * .2); x.lineTo(w * .5 + Math.cos(a) * w * .28, h * .4 + Math.sin(a) * w * .28); x.stroke(); }
      circ(x, w * .5, h * .4, w * .16, '#ffd54f'); circ(x, w * .45, h * .38, 3, '#5d4037'); circ(x, w * .55, h * .38, 3, '#5d4037'); x.strokeStyle = '#5d4037'; x.lineWidth = 2.5; x.beginPath(); x.arc(w * .5, h * .41, w * .06, .3, 2.84); x.stroke(); x.fillStyle = '#8bc34a'; x.beginPath(); x.ellipse(w * .5, h * 1.02, w * .8, h * .2, 0, 0, 7); x.fill(); },
    rainbow(x, w, h) { x.fillStyle = lg(x, h, ['#b3e5fc', '#e1f5fe']); x.fillRect(0, 0, w, h); ['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5', '#7e57c2'].forEach((c, i) => { x.strokeStyle = c; x.lineWidth = w * .045; x.beginPath(); x.arc(w * .5, h * .72, w * (.38 - i * .045), Math.PI, 0); x.stroke(); });
      [[.18, .72], [.82, .72]].forEach(([a, b]) => { circ(x, w * a, h * b, w * .09, '#fff'); circ(x, w * (a - .07), h * (b + .02), w * .07, '#fff'); circ(x, w * (a + .07), h * (b + .02), w * .07, '#fff'); }); },
    rocket(x, w, h) { x.fillStyle = lg(x, h, ['#1a1446', '#3d2a7a']); x.fillRect(0, 0, w, h); const r = rnd(9); for (let i = 0; i < 30; i++) circ(x, r() * w, r() * h, r() * 1.5 + .3, '#fff'); circ(x, w * .2, h * .2, w * .07, '#ffb74d');
      x.save(); x.translate(w * .55, h * .5); x.rotate(.5); x.fillStyle = '#eceff1'; x.beginPath(); x.ellipse(0, 0, w * .08, h * .17, 0, 0, 7); x.fill(); circ(x, 0, -h * .04, w * .035, '#4fc3f7'); poly(x, [[-w * .08, h * .08], [-w * .14, h * .18], [-w * .05, h * .15]], '#ef5350'); poly(x, [[w * .08, h * .08], [w * .14, h * .18], [w * .05, h * .15]], '#ef5350');
      poly(x, [[-w * .04, h * .17], [0, h * .3], [w * .04, h * .17]], '#ffa726'); x.restore(); },
    clouds(x, w, h) { x.fillStyle = '#b3261e'; x.fillRect(0, 0, w, h); x.strokeStyle = '#f2c46b'; x.lineWidth = 2.5; for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) { const cx = w * (.2 + i * .3 + (j % 2) * .15), cy = h * (.15 + j * .23);
      x.beginPath(); x.arc(cx, cy, w * .06, Math.PI, 0); x.arc(cx + w * .09, cy, w * .03, Math.PI, 0); x.arc(cx - w * .09, cy, w * .03, Math.PI, 0); x.stroke(); } x.strokeRect(w * .06, h * .04, w * .88, h * .92); },
    lantern(x, w, h) { x.fillStyle = lg(x, h, ['#2d0f24', '#5a1730']); x.fillRect(0, 0, w, h); [[.3, .38, 1], [.68, .5, .8]].forEach(([a, b, s]) => { x.strokeStyle = '#d4a24c'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(w * a, 0); x.lineTo(w * a, h * b - h * .12 * s); x.stroke();
      x.fillStyle = '#e53935'; x.beginPath(); x.ellipse(w * a, h * b, w * .14 * s, h * .1 * s, 0, 0, 7); x.fill(); x.fillStyle = '#d4a24c'; x.fillRect(w * a - w * .06 * s, h * b - h * .11 * s, w * .12 * s, h * .02); x.fillRect(w * a - w * .06 * s, h * b + h * .09 * s, w * .12 * s, h * .02);
      x.strokeStyle = '#d4a24c'; x.beginPath(); x.moveTo(w * a, h * b + h * .11 * s); x.lineTo(w * a, h * b + h * .2 * s); x.stroke(); }); },
    plum(x, w, h) { x.fillStyle = '#f3ead8'; x.fillRect(0, 0, w, h); x.strokeStyle = '#3b2a22'; x.lineCap = 'round'; const br = (x0, y0, x1, y1, lw) => { x.lineWidth = lw; x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo((x0 + x1) / 2 + 8, (y0 + y1) / 2 - 8, x1, y1); x.stroke(); };
      br(0, h * .9, w * .55, h * .35, 6); br(w * .3, h * .62, w * .75, h * .55, 3); br(w * .5, h * .4, w * .62, h * .12, 2.5); const r = rnd(4); for (let i = 0; i < 12; i++) { const px = w * (.2 + r() * .6), py = h * (.15 + r() * .6); for (let k = 0; k < 5; k++) circ(x, px + Math.cos(k * 1.256) * 4, py + Math.sin(k * 1.256) * 4, 3.6, '#d9466f'); circ(x, px, py, 2, '#f7d24a'); }
      x.fillStyle = '#b3261e'; x.fillRect(w * .78, h * .78, w * .1, w * .1); },
    gift(x, w, h) { x.fillStyle = lg(x, h, ['#fce4ec', '#f8bbd0']); x.fillRect(0, 0, w, h); x.fillStyle = '#7e57c2'; x.fillRect(w * .25, h * .45, w * .5, h * .35); x.fillStyle = '#9575cd'; x.fillRect(w * .22, h * .38, w * .56, h * .09);
      x.fillStyle = '#ffd54f'; x.fillRect(w * .46, h * .38, w * .08, h * .42); x.strokeStyle = '#ffd54f'; x.lineWidth = 5; x.beginPath(); x.ellipse(w * .42, h * .33, w * .07, h * .04, -.4, 0, 7); x.stroke(); x.beginPath(); x.ellipse(w * .58, h * .33, w * .07, h * .04, .4, 0, 7); x.stroke(); },
    house(x, w, h) { x.fillStyle = lg(x, h, ['#ffe0b2', '#ffcc80']); x.fillRect(0, 0, w, h); poly(x, [[w * .2, h * .5], [w * .5, h * .25], [w * .8, h * .5]], '#c62828'); x.fillStyle = '#fff8e1'; x.fillRect(w * .26, h * .5, w * .48, h * .32);
      x.fillStyle = '#6d4c41'; x.fillRect(w * .44, h * .62, w * .12, h * .2); x.fillStyle = '#ffd54f'; x.fillRect(w * .31, h * .56, w * .09, w * .09); x.fillRect(w * .6, h * .56, w * .09, w * .09); x.fillStyle = '#8bc34a'; x.fillRect(0, h * .82, w, h); },
    gem(x, w, h) { x.fillStyle = lg(x, h, ['#0d2b45', '#203c5c']); x.fillRect(0, 0, w, h); const c = [w * .5, h * .45]; poly(x, [[w * .3, h * .38], [w * .4, h * .28], [w * .6, h * .28], [w * .7, h * .38], [w * .5, h * .66]], '#4dd0e1');
      poly(x, [[w * .3, h * .38], [w * .7, h * .38], [w * .5, h * .66]], '#26a6b8'); poly(x, [[w * .4, h * .28], [w * .5, h * .38], [w * .6, h * .28]], '#b2ebf2'); for (let i = 0; i < 5; i++) circ(x, w * (.2 + i * .15), h * .82, w * .05, '#f6c445'); }
  };
  const draw = (x, id, w, h) => { const c = L[(id | 0) % L.length] || L[0]; x.save(); P[c[1]](x, w, h); x.restore(); };
  const forCat = cat => L.map((c, i) => [i, c[0]]).filter(c => c[1] === cat).map(c => c[0]);
  const url = (() => { const m = new Map(); return (id, w = 120, h = 160) => { const k = id + 'x' + w; if (!m.has(k)) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), id, w, h); m.set(k, cv.toDataURL()); } return m.get(k); }; })();
  const GROUPS = { classic: ['经典', '风景', '人物', '动物', '卡通'], nature: ['自然'], minimal: ['简约'], emotion: ['情感'] };
  window.WTCovers = { count: L.length, list: L, draw, forCat, url, GROUPS, ids: g => L.map((c, i) => [i, c[0]]).filter(c => GROUPS[g].includes(c[1])).map(c => c[0]) };
})();

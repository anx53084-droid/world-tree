// 世界树确定性分层地址空间（前后端共用，UMD）
// 卡片序号 i（0 起，按上链/索引顺序）→ 路径：8 级、每级 16 叉，低位优先：d_j = floor(i/16^j) % 16（j=0..7），槽位 slot = floor(i/16^8)（0..63）
// 任一卡片的位置只由 i 决定，无需加载其它卡片；容量 16^8 × 64 ≈ 2.75e11（需更多时在末尾再加一级即可，旧地址不变）
// 低位优先使前若干张卡均匀铺满 16 个大区，而非挤在同一枝。前缀（region，十六进制串，长度 k）下的卡片数为 O(1) 公式。
(function (root, f) { const m = f(); if (typeof module === 'object' && module.exports) module.exports = m; else root.WTAddr = m; })(typeof self !== 'undefined' ? self : this, function () {
  const B = 16, DEPTH = 8, SLOTS = 64, M8 = B ** DEPTH, CAPACITY = M8 * SLOTS, HANG = 64; // HANG：子树卡片数 ≤ HANG 时直接把卡挂在该节点（稀疏子树折叠）
  const HEX = '0123456789abcdef';
  const pathOf = i => { let s = ''; for (let j = 0, x = i; j < DEPTH; j++, x = Math.floor(x / B)) s += HEX[x % B]; return { region: s, slot: Math.floor(i / M8) }; };
  const prefixVal = r => { let p = 0; for (let j = r.length - 1; j >= 0; j--) p = p * B + HEX.indexOf(r[j]); return p; };
  const valid = r => typeof r === 'string' && r.length <= DEPTH && /^[0-9a-f]*$/.test(r);
  const count = (r, N) => { const p = prefixVal(r), M = B ** r.length; return p >= N ? 0 : Math.ceil((N - p) / M); }; // #{ i < N : i ≡ p (mod 16^k) }
  const cardsIn = (r, N, limit = HANG) => { const p = prefixVal(r), M = B ** r.length, out = []; for (let i = p; i < N && out.length < limit; i += M) out.push(i); return out; };
  // 确定性伪随机（支持 i 到 2^53）
  const hash = (i, salt = 0) => { let h = (i % 4294967296) ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b), l = Math.floor(i / 4294967296);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h ^= Math.imul(l + 0x27d4eb2f, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); return ((h ^ (h >>> 16)) >>> 0); };
  const CATS = ['经典', '风景', '人物', '动物', '卡通'];
  const A = ['愿', '希望', '祝', '盼', '但愿'], Bw = ['家人', '自己', '朋友们', '小猫', '爸妈', '世界', '你', '大家', '宝宝', '我们'],
    C = ['平安喜乐', '健康长寿', '考试顺利', '早日暴富', '心想事成', '永远开心', '前程似锦', '万事胜意', '岁岁平安', '梦想成真', '一路花开', '星河长明'];
  const synth = i => { const h = hash(i), h2 = hash(i, 7); return { id: i, sig: 'SYN' + i, cat: CATS[h % 5], text: A[h2 % 5] + Bw[(h2 >>> 4) % 10] + C[(h2 >>> 9) % 12],
    likes: h % 97 < 70 ? h % 7 : (h >>> 8) % 300, blessN: (h >>> 20) % 6, author: 'Syn' + (h2 >>> 0).toString(36).padEnd(8, 'x'), time: 1790000000 + (i % 31536000), synthetic: true }; };
  return { B, DEPTH, SLOTS, HANG, CAPACITY, HEX, pathOf, prefixVal, valid, count, cardsIn, synth, hash };
});

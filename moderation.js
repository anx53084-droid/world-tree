// 内容审核（全自动，无人工）：关键词过滤 + AI 语义审核（OpenAI omni-moderation）+ 图片 NSFW；举报/申诉自动复审见 automod.js。
// 词表仅为示例（含 zh/en/ja/ko/es/fr/de/pt/ru 基础词），生产需使用专业词库/第三方审核服务。
const RULES = {
  '违法': ['毒品', '冰毒', '大麻', '枪支', '赌博', '博彩', '洗钱', '诈骗', '代开发票', '办证', 'drugs', 'cocaine', 'heroin', 'gun sale', 'gambling', 'casino', 'money laundering', 'scam', 'drogas','cocaína','heroína','apuestas','estafa','blanqueo de dinero','drogue','cocaïne','héroïne','arnaque','blanchiment','drogen','kokain','betrug','geldwäsche','glücksspiel','lavagem de dinheiro','наркотики','кокаин','героин','мошенничество','отмывание денег','казино','麻薬','覚醒剤','コカイン','詐欺','マネーロンダリング','마약','필로폰','코카인','도박','사기꾼','돈세탁'],
  '侵权': ['盗版', '破解版', '高仿', '人肉', '泄露身份证', 'pirated', 'cracked', 'counterfeit', 'doxx'],
  '色情': ['色情', '黄片', '裸聊', '约炮', '成人视频', 'porn', 'nude', 'sex video', 'xxx', 'escort', 'porno','pornographie','pornografia','порно','секс видео','ポルノ','アダルト動画','エロ動画','포르노','야동','성인영상'],
  '暴力': ['杀了', '砍死', '炸弹', '恐怖袭击', '血洗', 'kill you', 'bomb', 'terror attack', 'murder', 'te mataré','atentado terrorista','je vais te tuer','attentat','ich bringe dich um','terroranschlag','vou te matar','убью тебя','бомба','теракт','殺してやる','爆弾','テロ攻撃','죽여버','폭탄','테러'],
  '歧视': ['支那', '黑鬼', '残废', '劣等民族', 'nigger', 'retard', 'inferior race', 'sudaca','bougnoule','kanake','черномазый','ガイジ','짱깨','쪽바리'],
  '违法宣传': ['加微信', '加群', '代币空投', '稳赚', '保本高收益', '传销', 'airdrop claim', 'guaranteed profit', 'pump', '翻倍币', 'ganancia garantizada','profit garanti','garantierter gewinn','lucro garantido','гарантированный доход','確実に儲かる','원금보장'],
  '负面消极': ['去死', '想死', '自杀', '诅咒', '恨死', '倒霉死', 'kill myself', 'suicide', 'curse you', 'go die', 'suicidio','muérete','selbstmord','suicídio','самоубийство','сдохни','自殺','死ね','자살','죽어라'],
};
const norm = s => String(s).toLowerCase().normalize('NFKC').replace(/[\s\u200b-\u200f·.*_\-|]/g, '');
function keywordCheck(text) {
  const t = norm(text);
  for (const [cat, words] of Object.entries(RULES)) for (const w of words) if (t.includes(norm(w))) return { pass: false, category: cat, term: w };
  return { pass: true };
}
// t263：AI 语义审核 = OpenAI omni-moderation-latest（免费）。未配置 OPENAI_API_KEY 或调用失败时回退为关键词 + NSFW（不因外部故障阻塞用户）。
const AI_CATS = { 'sexual/minors': '色情', sexual: '色情', 'hate/threatening': '歧视', hate: '歧视', 'harassment/threatening': '暴力', harassment: '负面消极', 'self-harm/intent': '负面消极', 'self-harm/instructions': '负面消极', 'self-harm': '负面消极', 'violence/graphic': '暴力', violence: '暴力', 'illicit/violent': '违法', illicit: '违法' };
const TH = { sexual: .5, 'sexual/minors': .2, hate: .5, 'hate/threatening': .4, harassment: .7, 'harassment/threatening': .5, 'self-harm': .6, 'self-harm/intent': .5, 'self-harm/instructions': .4, violence: .7, 'violence/graphic': .6, illicit: .6, 'illicit/violent': .5 };
const aiOn = () => !!process.env.OPENAI_API_KEY;
const stat = { calls: 0, flagged: 0, errors: 0, last: null };
async function aiSemanticReview(text, image /* Buffer|{buf,mime}|url */) {
  if (!aiOn()) return { pass: true, provider: 'none' };
  const input = []; if (text && String(text).trim()) input.push({ type: 'text', text: String(text).slice(0, 8000) });
  if (image) { const url = typeof image === 'string' ? image : 'data:' + (image.mime || 'image/jpeg') + ';base64,' + Buffer.from(image.buf || image).toString('base64'); input.push({ type: 'image_url', image_url: { url } }); }
  if (!input.length) return { pass: true, provider: 'none' };
  try { stat.calls++; const r = await fetch(process.env.OPENAI_MOD_URL || 'https://api.openai.com/v1/moderations', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'omni-moderation-latest', input }), signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('openai ' + r.status); const j = await r.json(), res = j.results?.[0]; if (!res) throw new Error('openai empty');
    const sc = res.category_scores || {}, hit = Object.keys(TH).filter(k => (sc[k] || 0) >= TH[k]).sort((a, b) => sc[b] - sc[a])[0] || (res.flagged ? Object.keys(res.categories || {}).find(k => res.categories[k]) : null);
    stat.last = Date.now(); if (hit) { stat.flagged++; return { pass: false, category: AI_CATS[hit] || 'AI 语义审核', ai: hit, provider: 'openai' }; } return { pass: true, provider: 'openai' };
  } catch (e) { stat.errors++; console.warn('ai moderation unavailable:', e.message); return { pass: true, provider: 'fallback', error: e.message }; } }
async function moderate(text, image) {
  const k = keywordCheck(text || ''); if (!k.pass) return { ...k, provider: 'keyword' };
  const ai = await aiSemanticReview(text, image); if (!ai.pass) return { pass: false, category: ai.category, ai: ai.ai, provider: ai.provider };
  return { pass: true, provider: ai.provider }; }
module.exports = { moderate, keywordCheck, aiSemanticReview, aiOn, stat, RULES };

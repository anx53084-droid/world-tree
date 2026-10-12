// 内容审核（上链前）。MVP：关键词过滤 + AI 语义审核桩 + 人工复核队列。
// 词表仅为示例，生产需使用专业词库/第三方审核服务。
const fs = require('fs'), path = require('path');
const RULES = {
  '违法': ['毒品', '冰毒', '大麻', '枪支', '赌博', '博彩', '洗钱', '诈骗', '代开发票', '办证', 'drugs', 'cocaine', 'heroin', 'gun sale', 'gambling', 'casino', 'money laundering', 'scam'],
  '侵权': ['盗版', '破解版', '高仿', '人肉', '泄露身份证', 'pirated', 'cracked', 'counterfeit', 'doxx'],
  '色情': ['色情', '黄片', '裸聊', '约炮', '成人视频', 'porn', 'nude', 'sex video', 'xxx', 'escort'],
  '暴力': ['杀了', '砍死', '炸弹', '恐怖袭击', '血洗', 'kill you', 'bomb', 'terror attack', 'murder'],
  '歧视': ['支那', '黑鬼', '残废', '劣等民族', 'nigger', 'retard', 'inferior race'],
  '违法宣传': ['加微信', '加群', '代币空投', '稳赚', '保本高收益', '传销', 'airdrop claim', 'guaranteed profit', 'pump', '翻倍币'],
  '负面消极': ['去死', '想死', '自杀', '诅咒', '恨死', '倒霉死', 'kill myself', 'suicide', 'curse you', 'go die'],
};
const norm = s => String(s).toLowerCase().normalize('NFKC').replace(/[\s\u200b-\u200f·.*_\-|]/g, '');
function keywordCheck(text) {
  const t = norm(text);
  for (const [cat, words] of Object.entries(RULES)) for (const w of words) if (t.includes(norm(w))) return { pass: false, category: cat, term: w };
  return { pass: true };
}
// 桩：接入大模型/第三方内容安全 API 做语义审核（如阿里云/腾讯云内容安全、OpenAI moderation 等）
async function aiSemanticReview(text /*, imageUrl */) { return { pass: true, provider: 'stub' }; }
// 人工复核队列：可疑但未命中关键词的内容可推入此队列（MVP 仅记录，不阻塞）
const QUEUE = path.join(__dirname, 'data', 'review-queue.jsonl');
function enqueueManual(item) { fs.mkdirSync(path.dirname(QUEUE), { recursive: true }); fs.appendFileSync(QUEUE, JSON.stringify({ ...item, at: Date.now() }) + '\n'); }
async function moderate(text) {
  const k = keywordCheck(text); if (!k.pass) return k;
  const ai = await aiSemanticReview(text); if (!ai.pass) return { pass: false, category: ai.category || 'AI 语义审核' };
  if (/https?:\/\/|www\.|\d{7,}/i.test(text)) enqueueManual({ text, reason: '含链接/长数字，建议人工复核' });
  return { pass: true };
}
module.exports = { moderate, keywordCheck, RULES };

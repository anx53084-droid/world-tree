// 星愿大使 · 还愿（物质类）—— 链下履约 + 内部记账。无 LP / 无收益分润。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const web3 = require('@solana/web3.js');
const nacl = require('tweetnacl');

const MATERIAL = '物质类';
const FULFILL_FUND_BPS = Math.max(0, Math.min(10000, parseInt(process.env.FULFILL_FUND_BPS || '2000', 10) || 2000)); // 占总支付比例，默认 2000 = 20%（无 20/80 拆分后按全额计）
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = path.join(__dirname, 'data');
const FUL_F = path.join(DATA_DIR, 'fulfillments.json');
const LEDGER_F = path.join(DATA_DIR, 'fund-ledger.json');
const MEMO = new web3.PublicKey('MemoSq4gqABAXKb96qnH8TuDybDJ9cKfTLqKE7Rbr8z');
const TREE = new web3.PublicKey('pqaQKFsNjfJKewkwEyJaNYzoKxu3sh1hmNvAGKfz5Yb');

function loadJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }
function saveJson(f, obj) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 2), { mode: 0o600 }); }
function sha256hex(t) { return crypto.createHash('sha256').update(String(t), 'utf8').digest('hex'); }

function loadFulfillments() { const d = loadJson(FUL_F, { wishes: {} }); if (!d.wishes) d.wishes = {}; return d; }
function saveFulfillments(d) { saveJson(FUL_F, d); }
function loadLedger() { const d = loadJson(LEDGER_F, { fundBps: FULFILL_FUND_BPS, entries: [] }); if (!Array.isArray(d.entries)) d.entries = []; return d; }
function saveLedger(d) { saveJson(LEDGER_F, d); }

function adminOk(req) {
  if (!ADMIN_KEY) return false;
  const k = req.headers['x-admin-key'];
  return typeof k === 'string' && k.length > 0 && k === ADMIN_KEY;
}

/** 记账：全额入账后按 FULFILL_FUND_BPS 记还愿基金（纯会计，不上链、不展示；无 20/80 拆分） */
function recordFund(wishSig, lamports, source) {
  const lam = Math.max(0, Math.floor(+lamports || 0));
  if (!wishSig || !lam) return null;
  const ledger = loadLedger();
  if (ledger.entries.some(e => e.wishSig === wishSig)) return ledger.entries.find(e => e.wishSig === wishSig);
  const treasuryShare = lam; // 全额为项目收款
  const fundLamports = Math.floor(treasuryShare * FULFILL_FUND_BPS / 10000);
  const entry = { wishSig, lamports: lam, treasuryShare, fundBps: FULFILL_FUND_BPS, fundLamports, at: Date.now(), source: source || 'unknown' };
  ledger.fundBps = FULFILL_FUND_BPS;
  ledger.entries.push(entry);
  saveLedger(ledger);
  return entry;
}

function registerWish({ wishSig, cat, text, author, lamports, shippingNote, source }) {
  if (!wishSig || typeof wishSig !== 'string' || wishSig.length < 8 || wishSig.length > 128) return { error: 'wishSig invalid', code: 'param' };
  recordFund(wishSig, lamports, source || 'register');
  if (cat !== MATERIAL) return { ok: true, material: false };
  const db = loadFulfillments();
  const prev = db.wishes[wishSig];
  if (prev && prev.status === 'fulfilled') return { ok: true, material: true, status: 'fulfilled' };
  const note = typeof shippingNote === 'string' ? shippingNote.trim().slice(0, 500) : '';
  db.wishes[wishSig] = {
    wishSig, cat: MATERIAL, text: typeof text === 'string' ? text.slice(0, 140) : (prev?.text || ''),
    author: typeof author === 'string' ? author.slice(0, 64) : (prev?.author || ''),
    shippingNote: note || prev?.shippingNote || '', // 仅存服务器，永不写入链上、不进公开 API
    lamports: Math.max(0, Math.floor(+lamports || prev?.lamports || 0)),
    status: prev?.status || 'pending',
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  saveFulfillments(db);
  return { ok: true, material: true, status: db.wishes[wishSig].status };
}

function publicView(wishSig) {
  const w = loadFulfillments().wishes[wishSig];
  if (!w) return null;
  // 绝不返回 shippingNote
  const out = { wishSig: w.wishSig, cat: w.cat, status: w.status, fulfilled: w.status === 'fulfilled' };
  if (w.status === 'fulfilled') {
    out.badge = true;
    out.fulfillNote = w.fulfillNote || '';
    out.fulfillTs = w.fulfillTs || 0;
    out.fulfillNoteHash = w.fulfillNoteHash || '';
    out.fulfillAttestation = w.fulfillAttestation || '';
    if (w.fulfillTx) out.fulfillTx = w.fulfillTx;
  }
  return out;
}

function listPending() {
  return Object.values(loadFulfillments().wishes)
    .filter(w => w.status === 'pending')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map(w => ({
      wishSig: w.wishSig, cat: w.cat, text: w.text, author: w.author,
      shippingNote: w.shippingNote || '', lamports: w.lamports || 0,
      createdAt: w.createdAt, status: w.status
    }));
}

function listAll(status) {
  let list = Object.values(loadFulfillments().wishes);
  if (status) list = list.filter(w => w.status === status);
  return list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .map(w => ({
      wishSig: w.wishSig, cat: w.cat, text: w.text, author: w.author,
      shippingNote: w.shippingNote || '', lamports: w.lamports || 0,
      status: w.status, createdAt: w.createdAt, fulfilledAt: w.fulfilledAt,
      fulfillNote: w.fulfillNote, fulfillTx: w.fulfillTx, tipLamports: w.tipLamports
    }));
}

function fulMsg(wishSig, noteHash, ts) { return Buffer.from(`WTREE-FUL1|${wishSig}|${noteHash}|${ts}`, 'utf8'); }

function signFulfill(modKey, wishSig, note) {
  const noteHash = sha256hex(note || '');
  const ts = Math.floor(Date.now() / 1000);
  const sig = Buffer.from(nacl.sign.detached(fulMsg(wishSig, noteHash, ts), modKey.secretKey)).toString('hex');
  return { noteHash, ts, sig, memo: `WTREE1|F|${wishSig}|${noteHash}|${ts}|${sig}` };
}

function parseHotWallet() {
  const raw = process.env.FULFILL_HOT_WALLET;
  if (!raw) return null;
  try {
    const v = String(raw).replace(/[\s`'"]/g, '');
    let secret;
    if (/^[0-9a-fA-F]{128}$/.test(v)) secret = Buffer.from(v, 'hex');
    else {
      try { const b = require('bs58').decode(v); if (b.length === 64) secret = Buffer.from(b); } catch {}
      if (!secret) { const j = JSON.parse(v); secret = Buffer.from(Array.isArray(j) ? j : j.secretKey || j); }
    }
    if (!secret || secret.length !== 64) return null;
    return web3.Keypair.fromSecretKey(secret);
  } catch { return null; }
}

async function maybeSendTipAndMemo(conn, memo, tipLamports, tipTo) {
  const kp = parseHotWallet();
  if (!kp) return { skipped: true, reason: 'no FULFILL_HOT_WALLET' };
  const tx = new web3.Transaction();
  const tip = Math.max(0, Math.floor(+tipLamports || 0));
  if (tip > 0 && tipTo) {
    try { tx.add(web3.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new web3.PublicKey(tipTo), lamports: tip })); }
    catch { /* ignore bad tipTo */ }
  }
  tx.add(web3.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: TREE, lamports: 0 }));
  tx.add(new web3.TransactionInstruction({ programId: MEMO, keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(memo, 'utf8') }));
  try {
    const sig = await web3.sendAndConfirmTransaction(conn, tx, [kp], { commitment: 'confirmed' });
    return { signature: sig, tipLamports: tip };
  } catch (e) {
    return { error: e.message, memoOnlyFailed: true };
  }
}

async function markFulfilled({ wishSig, note, tipLamports, tipTo, modKey, conn }) {
  const db = loadFulfillments();
  let w = db.wishes[wishSig];
  if (!w) {
    w = db.wishes[wishSig] = { wishSig, cat: MATERIAL, text: '', author: '', shippingNote: '', lamports: 0, status: 'pending', createdAt: Date.now() };
  }
  if (w.status === 'fulfilled') return { ok: true, already: true, public: publicView(wishSig) };
  const fulfillNote = typeof note === 'string' ? note.trim().slice(0, 280) : '';
  const signed = signFulfill(modKey, wishSig, fulfillNote);
  let chain = { skipped: true };
  if (conn) chain = await maybeSendTipAndMemo(conn, signed.memo, tipLamports, tipTo || w.author);
  w.status = 'fulfilled';
  w.fulfilledAt = Date.now();
  w.fulfillNote = fulfillNote;
  w.fulfillNoteHash = signed.noteHash;
  w.fulfillTs = signed.ts;
  w.fulfillAttestation = signed.sig;
  w.fulfillMemo = signed.memo;
  w.tipLamports = Math.max(0, Math.floor(+tipLamports || 0));
  if (chain.signature) w.fulfillTx = chain.signature;
  w.updatedAt = Date.now();
  saveFulfillments(db);
  return { ok: true, public: publicView(wishSig), chain, memo: signed.memo };
}

module.exports = {
  MATERIAL, FULFILL_FUND_BPS, ADMIN_KEY, adminOk,
  recordFund, registerWish, publicView, listPending, listAll, markFulfilled, loadLedger, sha256hex
};

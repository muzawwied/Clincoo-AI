// Model A — helper bersama: CORS, skema D1, tokenisasi, skor kemiripan, rate limit.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

// ---- Skema (dibuat lazy, idempoten) ----
export async function ensureTables(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    prompt_norm TEXT DEFAULT '',
    answer TEXT NOT NULL,
    source TEXT DEFAULT 'manusia',
    rating INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_examples_prompt_norm ON examples(prompt_norm)').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS chat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT DEFAULT '',
    reply TEXT DEFAULT '',
    matched_id INTEGER,
    score REAL DEFAULT 0,
    feedback INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS write_log (
    ip TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    window_start TEXT DEFAULT (datetime('now'))
  )`).run();
}

// ---- Rate limit tulis per IP: maks n aksi per window menit (anti-spam data latihan) ----
export async function rateLimit(db, request, max = 40, windowMinutes = 60) {
  await ensureTables(db);
  const ip = clientIp(request);
  const row = await db.prepare('SELECT * FROM write_log WHERE ip = ?').bind(ip).first();
  const now = Date.now();
  const winStart = row ? new Date(String(row.window_start).replace(' ', 'T') + 'Z').getTime() : 0;
  if (!row || isNaN(winStart) || now - winStart > windowMinutes * 60000) {
    await db.prepare("INSERT INTO write_log (ip, count, window_start) VALUES (?, 1, datetime('now')) ON CONFLICT(ip) DO UPDATE SET count = 1, window_start = datetime('now')").bind(ip).run();
    return true;
  }
  if ((row.count || 0) >= max) return false;
  await db.prepare('UPDATE write_log SET count = count + 1 WHERE ip = ?').bind(ip).run();
  return true;
}

// ---- Tokenisasi bahasa Indonesia (stopwords ringan) ----
const STOPWORDS = new Set(('yang di ke dari pada untuk dengan dalam adalah itu ini apa bagaimana kenapa mengapa gimana tolong coba bisa boleh kah aku saya kamu anda kau kita kami mereka dia ia ia ada tidak bukan ya tidak udah sudah akan mau ingin banget very the a an is are of to for in on at what how why do does can could please'.split(' ')));

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

export function normalizePrompt(text) {
  return tokenize(text).sort().join(' ');
}

// ---- Mesin "Model A": pencocokan BM25-lite atas kumpulan data latihan ----
export function bestMatch(question, examples) {
  const qTokens = tokenize(question);
  if (!qTokens.length) return null;
  const k1 = 1.4, b = 0.72;
  const N = examples.length || 1;
  // Document frequency tiap token query atas seluruh prompt latihan
  const df = {};
  for (const ex of examples) {
    const seen = new Set(tokenize(ex.prompt));
    for (const t of qTokens) if (seen.has(t)) df[t] = (df[t] || 0) + 1;
  }
  let best = null;
  for (const ex of examples) {
    const docTokens = tokenize(ex.prompt);
    const docLen = docTokens.length || 1;
    const avgLen = 8; // panjang prompt manusia rata-rata; cukup stabil untuk skoring
    let score = 0;
    for (const t of qTokens) {
      if (!df[t]) continue;
      const tf = docTokens.filter(d => d === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgLen));
    }
    // Bonus: contoh yang disetujui manusia lebih dipercaya
    if (ex.rating === 1) score *= 1.15;
    if (score > 0 && (!best || score > best.score)) best = { example: ex, score: score };
  }
  return best;
}

// Ambang kemiripan: di bawah ini Model A jujur mengaku belum dilatih.
export const MATCH_THRESHOLD = 1.35;

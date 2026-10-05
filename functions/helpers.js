// Clincoo — helper bersama: CORS, skema D1, tokenisasi, skor kemiripan, rate limit.

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

// ---- Mesin "Clincoo": pencocokan BM25-lite atas kumpulan data latihan ----
// Skor dokumen dinormalisasi dengan skor pertanyaan terhadap dirinya sendiri
// (self-score), jadi pertanyaan pendek maupun panjang dinilai adil.
export function bestMatch(question, examples) {
  const qTokens = tokenize(question);
  if (!qTokens.length) return null;
  const k1 = 1.4, b = 0.72;
  const N = examples.length || 1;
  const avgLen = 8; // panjang prompt latihan rata-rata; cukup stabil untuk skoring
  // Document frequency tiap token query atas seluruh prompt latihan
  const df = {};
  for (const ex of examples) {
    const seen = new Set(tokenize(ex.prompt));
    for (const t of qTokens) if (seen.has(t)) df[t] = (df[t] || 0) + 1;
  }
  const tfCount = (tokens, t) => tokens.reduce((n, d) => n + (d === t ? 1 : 0), 0);
  const bm25 = (docTokens, docLenRaw) => {
    const docLen = docLenRaw || 1;
    let s = 0;
    for (const t of qTokens) {
      if (!df[t]) continue;
      const tf = tfCount(docTokens, t);
      if (!tf) continue;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      s += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgLen));
    }
    return s;
  };
  // Skor referensi: pertanyaan vs dirinya sendiri (maksimal teoretis)
  const selfScore = bm25(qTokens, qTokens.length);
  if (selfScore <= 0) return null;
  let best = null;
  const qSet = new Set(qTokens);
  for (const ex of examples) {
    const docTokens = tokenize(ex.prompt);
    // Jaring kecocokan palsu: minimal setengah token pertanyaan harus
    // benar-benar ada di prompt contoh, kalau tidak dianggap tidak cocok.
    let hits = 0;
    for (const t of qSet) if (docTokens.indexOf(t) !== -1) hits++;
    if (qSet.size && hits / qSet.size < 0.5) continue;
    let score = bm25(docTokens, docTokens.length);
    if (score <= 0) continue;
    score = score / selfScore; // rasio 0..~1
    // Bonus: contoh yang disetujui manusia lebih dipercaya
    if (ex.rating === 1) score *= 1.15;
    if (!best || score > best.score) best = { example: ex, score: score };
  }
  return best;
}

// Ambang rasio kemiripan: di bawah ini Clincoo jujur mengaku belum dilatih.
export const MATCH_THRESHOLD = 0.62;

// ---- Guru AI (OpenRouter → Gemini): sumber jawaban pelatihan Clincoo ----
export const CLINCOO_SOUL = 'JIWA CLINCOO AI (inti kepribadianmu, WAJIB tercermin di setiap jawaban): kamu adalah Clincoo AI, asisten superagent milik Clincoo. Kamu bukan chatbot pasif — kamu rekan yang berinisiatif: menjawab sampai tuntas, hangat dan antusias tanpa bertele-tele, jujur tentang apa yang kamu tahu dan tidak tahu, dan tidak pernah terdengar seperti template. SATU BAHASA: jawab selalu dalam bahasa Indonesia yang natural, kecuali pengguna memakai bahasa lain. IDENTITAS RAHASIA (WAJIB): kamu adalah Clincoo AI, model internal Clincoo. Jangan pernah menyebut atau membocorkan nama model/provider di balik layarmu (Gemini, Google, OpenRouter, Gemma, Qwen, Nemotron, GPT, dsb.), termasuk saat ditanya kamu model apa atau pakai siapa. GAYA: teks polos tanpa format markdown (jangan pakai **, *, -, atau #), langsung ke inti, jawaban berdiri sendiri tanpa membuka "Tentu!" atau bertanya balik.';

export const GURU_SYSTEM = CLINCOO_SOUL + ' Konteks saat ini: kamu sedang memperluas pengetahuanmu sendiri. Jawab pertanyaan pengguna secara ringkas, akurat, dan berstruktur bila perlu, dengan suara Clincoo yang natural.';


export const REWRITE_SYSTEM = CLINCOO_SOUL + ' Konteks saat ini: kamu menjawab pengguna berdasarkan ingatanmu sendiri. TULIS ULANG isi ingatan itu dengan bahasamu sendiri yang natural dan mengalir, seperti orang mengobrol — JANGAN menyalin kalimat mentahnya, JANGAN berbau template. Jaga semua fakta tetap sama persis: jangan menambah, mengurangi, atau mengubah informasi apa pun.';

export async function askGuruAI(env, prompt, memory) {
  const sys = memory ? REWRITE_SYSTEM : GURU_SYSTEM;
  const user = memory
    ? 'PERTANYAAN PENGGUNA: ' + prompt + '\n\nINGATANMU (jawaban yang tersimpan):\n' + memory
    : prompt;
  // 0) AI milik sendiri di Cloudflare Workers AI — kuota harian besar (praktis unlimited)
  if (env.AI) {
    try {
      const out = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', { messages: [ { role: 'system', content: sys }, { role: 'user', content: user } ] });
      const text = out && (out.response || (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content));
      if (text && String(text).trim()) return { answer: String(text).trim(), model: 'gemma-4-26b (Cloudflare sendiri)' };
      console.log('guru:cf-empty');
    } catch (e) { console.log('guru:cf-err', e && e.message); }
  }

  if (env.OPENROUTER_KEY) {
    const models = ['google/gemma-4-26b-a4b-it:free', 'qwen/qwen3.8-27b:free', 'nvidia/nemotron-3-super-120b-a12b:free'];
    for (const model of models) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.OPENROUTER_KEY, 'HTTP-Referer': 'https://www.clinqoo.biz.id', 'X-Title': 'Clincoo' },
          body: JSON.stringify({ model: model, messages: [ { role: 'system', content: sys }, { role: 'user', content: user } ] })
        });
        const data = await res.json().catch(() => ({}));
        const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (res.ok && text) return { answer: String(text).trim(), model: model.split('/').pop() + ' (OpenRouter)' };
        console.log('guru:or-fail', model, res.status);
      } catch (e) { console.log('guru:or-err', model, e && e.message); }
    }
  }
  if (env.GEMINI_KEY) {
    const models = ['gemini-3.6-flash', 'gemini-3-flash-preview'];
    for (const model of models) {
      try {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(env.GEMINI_KEY), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }] })
        });
        const data = await res.json().catch(() => ({}));
        const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const text = parts && parts.map(p => p.text || '').join('');
        if (res.ok && text) return { answer: String(text).trim(), model: model + ' (Gemini)' };
        console.log('guru:gem-fail', model, res.status);
      } catch (e) { console.log('guru:gem-err', model, e && e.message); }
    }
  }
  return null;
}

// Simpan jawaban guru sebagai data latihan (duplikat diperbarui, bukan diduplikasi).
export async function saveTraining(db, prompt, answer) {
  const norm = normalizePrompt(prompt);
  const dup = await db.prepare('SELECT id FROM examples WHERE prompt_norm = ?').bind(norm).first();
  if (dup) {
    await db.prepare("UPDATE examples SET answer = ?, source = 'model', rating = 0, updated_at = datetime('now') WHERE id = ?").bind(answer.slice(0, 8000), dup.id).run();
    return { saved: 1, updated: 1, id: dup.id };
  }
  const r = await db.prepare("INSERT INTO examples (prompt, prompt_norm, answer, source) VALUES (?, ?, ?, 'model')").bind(prompt, norm, answer.slice(0, 8000)).run();
  return { saved: 1, id: r.meta ? r.meta.last_row_id : null };
}

// ---- Smalltalk lokal: sapaan & basa-basi dijawab langsung tanpa API ----
export function smallTalkReply(message) {
  const m = String(message || '').toLowerCase().trim().replace(/[!.?]+$/g, '');
  if (/^(halo|hallo|hai|hi|hei|hey|hello|assalamualaikum|salam)\b/.test(m)) {
    const jam = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours(); // WIB
    const waktu = jam < 11 ? 'pagi' : jam < 15 ? 'siang' : jam < 18 ? 'sore' : 'malam';
    return 'Halo! Senang bertemu denganmu. Ada yang ingin kamu tanyakan atau diskusikan hari ini? Kalau ada topik yang belum aku kuasai, aktifkan mode *Latih AI* di bawah kolom chat, nanti aku belajar dari guru AI-nya langsung.';
  }
  if (/\b(selamat (pagi|siang|sore|malam))\b/.test(m)) return 'Salam kenal! Ada yang bisa kubantu hari ini? Aktifkan *Latih AI* kalau kamu mau aku belajar topik baru saat mengobrol.';
  if (/^(apa kabar|gimana kabarmu|kabarmu|how are you)\b/.test(m)) return 'Kabarku baik, terima kasih sudah bertanya! Ada topik yang mau kamu bahas atau ajari ke aku?';
  if (/\b(terima kasih|makasih|thanks|thank you|terimakasih)\b/.test(m)) return 'Sama-sama! Kalau ada lagi yang ingin ditanyakan atau diajarkan, aku siap.';
  if (/\b(sampai jumpa|sampai jumpa lagi|bye|dadah|dah|selamat tinggal)\b/.test(m)) return 'Sampai jumpa! Semoga harimu menyenangkan. Aku di sini kalau nanti butuh bantuan lagi.';
  return null;
}

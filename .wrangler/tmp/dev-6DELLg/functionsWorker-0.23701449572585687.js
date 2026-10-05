var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/pages-PGImIN/functionsWorker-0.23701449572585687.mjs
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
  });
}
__name(json, "json");
__name2(json, "json");
function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}
__name(corsPreflight, "corsPreflight");
__name2(corsPreflight, "corsPreflight");
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "0.0.0.0";
}
__name(clientIp, "clientIp");
__name2(clientIp, "clientIp");
async function ensureTables(db) {
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
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_examples_prompt_norm ON examples(prompt_norm)").run();
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
__name(ensureTables, "ensureTables");
__name2(ensureTables, "ensureTables");
async function rateLimit(db, request, max = 40, windowMinutes = 60) {
  await ensureTables(db);
  const ip = clientIp(request);
  const row = await db.prepare("SELECT * FROM write_log WHERE ip = ?").bind(ip).first();
  const now = Date.now();
  const winStart = row ? (/* @__PURE__ */ new Date(String(row.window_start).replace(" ", "T") + "Z")).getTime() : 0;
  if (!row || isNaN(winStart) || now - winStart > windowMinutes * 6e4) {
    await db.prepare("INSERT INTO write_log (ip, count, window_start) VALUES (?, 1, datetime('now')) ON CONFLICT(ip) DO UPDATE SET count = 1, window_start = datetime('now')").bind(ip).run();
    return true;
  }
  if ((row.count || 0) >= max) return false;
  await db.prepare("UPDATE write_log SET count = count + 1 WHERE ip = ?").bind(ip).run();
  return true;
}
__name(rateLimit, "rateLimit");
__name2(rateLimit, "rateLimit");
var STOPWORDS = new Set("yang di ke dari pada untuk dengan dalam adalah itu ini apa bagaimana kenapa mengapa gimana tolong coba bisa boleh kah aku saya kamu anda kau kita kami mereka dia ia ia ada tidak bukan ya tidak udah sudah akan mau ingin banget very the a an is are of to for in on at what how why do does can could please".split(" "));
function tokenize(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}
__name(tokenize, "tokenize");
__name2(tokenize, "tokenize");
function normalizePrompt(text) {
  return tokenize(text).sort().join(" ");
}
__name(normalizePrompt, "normalizePrompt");
__name2(normalizePrompt, "normalizePrompt");
function bestMatch(question, examples) {
  const qTokens = tokenize(question);
  if (!qTokens.length) return null;
  const k1 = 1.4, b = 0.72;
  const N = examples.length || 1;
  const avgLen = 8;
  const df = {};
  for (const ex of examples) {
    const seen = new Set(tokenize(ex.prompt));
    for (const t of qTokens) if (seen.has(t)) df[t] = (df[t] || 0) + 1;
  }
  const tfCount = /* @__PURE__ */ __name2((tokens, t) => tokens.reduce((n, d) => n + (d === t ? 1 : 0), 0), "tfCount");
  const bm25 = /* @__PURE__ */ __name2((docTokens, docLenRaw) => {
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
  }, "bm25");
  const selfScore = bm25(qTokens, qTokens.length);
  if (selfScore <= 0) return null;
  let best = null;
  for (const ex of examples) {
    const docTokens = tokenize(ex.prompt);
    let score = bm25(docTokens, docTokens.length);
    if (score <= 0) continue;
    score = score / selfScore;
    if (ex.rating === 1) score *= 1.15;
    if (!best || score > best.score) best = { example: ex, score };
  }
  return best;
}
__name(bestMatch, "bestMatch");
__name2(bestMatch, "bestMatch");
var MATCH_THRESHOLD = 0.62;
async function onRequestOptions() {
  return corsPreflight();
}
__name(onRequestOptions, "onRequestOptions");
__name2(onRequestOptions, "onRequestOptions");
async function onRequestPost({ request, env }) {
  if (!await rateLimit(env.DB, request, 30, 60)) return json({ error: { message: "Terlalu banyak permintaan" } }, 429);
  await ensureTables(env.DB);
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m && m.role === "user");
  const question = String(lastUser && lastUser.content || "").trim().slice(0, 2e3);
  if (!question) return json({ error: { message: "Pesan pengguna tidak ditemukan" } }, 422);
  const rows = await env.DB.prepare(
    "SELECT id, prompt, answer, source, rating FROM examples WHERE rating != -1 ORDER BY id DESC LIMIT 2000"
  ).all();
  const examples = rows && rows.results ? rows.results : [];
  const match2 = bestMatch(question, examples);
  const reply = match2 && match2.score >= MATCH_THRESHOLD ? match2.example.answer : null;
  await env.DB.prepare("INSERT INTO chat_log (question, reply, matched_id, score) VALUES (?, ?, ?, ?)").bind(question.slice(0, 500), (reply || "").slice(0, 500), reply ? match2.example.id : null, match2 ? Math.round(match2.score * 100) / 100 : 0).run();
  const now = Math.floor(Date.now() / 1e3);
  return json({
    id: "chatcmpl-modela-" + now,
    object: "chat.completion",
    created: now,
    model: body.model || "model-a",
    choices: [{
      index: 0,
      message: { role: "assistant", content: reply || "Model A belum dilatih untuk pertanyaan ini. Tambahkan jawabannya lewat Playground." },
      finish_reason: reply ? "stop" : "no_match"
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}
__name(onRequestPost, "onRequestPost");
__name2(onRequestPost, "onRequestPost");
async function onRequestOptions2() {
  return corsPreflight();
}
__name(onRequestOptions2, "onRequestOptions2");
__name2(onRequestOptions2, "onRequestOptions");
var FALLBACK = "Aku belum dilatih untuk pertanyaan itu, jadi aku tidak akan menebak. Ajari aku lewat Playground di situs ini: tulis pertanyaan beserta jawaban terbaiknya, dan aku akan bisa menjawabnya di chat ini.";
var IDENTITY_ANSWER = "Aku Clincoo, asisten AI dari Clincoo. Aku dilatih lewat Model A: pengetahuanku disusun dari jawaban terkurasi manusia dan model besar, jadi aku hanya menjawab yang benar-benar aku tahu. Kalau ada yang belum aku ketahui, aku akan bilang jujur.";
function isIdentityQuestion(message) {
  const q = String(message || "").toLowerCase();
  if (/who are you|perkenalkan diri|perkenalkan dirimu/.test(q)) return true;
  return /(siapa|nama|sebut).{0,24}(kamu|namamu|nama kamu|kau|anda|lo|lu)(\b|$)/.test(q) || /^(kamu|kaau|u) (ini )?(siapa|apa)/.test(q) || /^(siapa|apa) (sih )?(kamu|namamu)/.test(q);
}
__name(isIdentityQuestion, "isIdentityQuestion");
__name2(isIdentityQuestion, "isIdentityQuestion");
async function onRequestPost2({ request, env }) {
  if (!await rateLimit(env.DB, request, 30, 60)) return json({ error: "Terlalu banyak pesan \u2014 tunggu sebentar lagi" }, 429);
  await ensureTables(env.DB);
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const message = String(body.message || "").trim().slice(0, 2e3);
  if (!message) return json({ error: "Pesan kosong" }, 422);
  const rows = await env.DB.prepare(
    "SELECT id, prompt, answer, source, rating FROM examples WHERE rating != -1 ORDER BY id DESC LIMIT 2000"
  ).all();
  const examples = rows && rows.results ? rows.results : [];
  let reply, matchedId = null, score = 0, matchedPrompt = null, source = null;
  if (isIdentityQuestion(message)) {
    reply = IDENTITY_ANSWER;
    source = "identitas";
    matchedPrompt = "(identitas bawaan)";
  } else {
    const match2 = bestMatch(message, examples);
    if (match2 && match2.score >= MATCH_THRESHOLD) {
      reply = match2.example.answer;
      matchedId = match2.example.id;
      score = Math.round(match2.score * 100) / 100;
      matchedPrompt = match2.example.prompt;
      source = match2.example.source;
    } else {
      reply = FALLBACK;
    }
  }
  const log = await env.DB.prepare(
    "INSERT INTO chat_log (question, reply, matched_id, score) VALUES (?, ?, ?, ?)"
  ).bind(message.slice(0, 500), reply.slice(0, 500), matchedId, score).run();
  return json({
    id: log.meta ? log.meta.last_row_id : null,
    reply,
    trained: matchedId != null,
    match: matchedPrompt ? { prompt: matchedPrompt, score, source } : null
  });
}
__name(onRequestPost2, "onRequestPost2");
__name2(onRequestPost2, "onRequestPost");
async function onRequestPatch({ request, env }) {
  if (!await rateLimit(env.DB, request, 60, 60)) return json({ error: "Terlalu banyak aksi" }, 429);
  await ensureTables(env.DB);
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const id = Number(body.id || 0);
  const rating = Number(body.rating || 0);
  if (!id || rating !== -1 && rating !== 1) return json({ error: "id dan rating (1/-1) wajib" }, 422);
  await env.DB.prepare("UPDATE chat_log SET feedback = ? WHERE id = ?").bind(rating, id).run();
  return json({ ok: true });
}
__name(onRequestPatch, "onRequestPatch");
__name2(onRequestPatch, "onRequestPatch");
async function onRequestOptions3() {
  return corsPreflight();
}
__name(onRequestOptions3, "onRequestOptions3");
__name2(onRequestOptions3, "onRequestOptions");
async function onRequestGet({ request, env }) {
  await ensureTables(env.DB);
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  let rows;
  if (q) {
    rows = await env.DB.prepare(
      "SELECT id, prompt, answer, source, rating, created_at FROM examples WHERE LOWER(prompt) LIKE ? OR LOWER(answer) LIKE ? ORDER BY id DESC LIMIT 200"
    ).bind("%" + q + "%", "%" + q + "%").all();
  } else {
    rows = await env.DB.prepare(
      "SELECT id, prompt, answer, source, rating, created_at FROM examples ORDER BY id DESC LIMIT 200"
    ).all();
  }
  const totals = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) AS rejected, SUM(CASE WHEN source = 'model' THEN 1 ELSE 0 END) AS from_model FROM examples"
  ).first();
  const items = (rows && rows.results ? rows.results : []).map((r) => ({
    id: r.id,
    prompt: r.prompt,
    answer: r.answer,
    source: r.source || "manusia",
    rating: r.rating || 0,
    created_at: r.created_at
  }));
  return json({
    items,
    total: totals && totals.total || 0,
    approved: totals && totals.approved || 0,
    rejected: totals && totals.rejected || 0,
    from_model: totals && totals.from_model || 0
  });
}
__name(onRequestGet, "onRequestGet");
__name2(onRequestGet, "onRequestGet");
async function onRequestPost3({ request, env }) {
  if (!await rateLimit(env.DB, request)) return json({ error: "Terlalu banyak aksi \u2014 tunggu sebentar lagi" }, 429);
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const prompt = String(body.prompt || "").trim().slice(0, 2e3);
  const answer = String(body.answer || "").trim().slice(0, 8e3);
  const source = body.source === "model" ? "model" : "manusia";
  if (prompt.length < 3 || answer.length < 1) return json({ error: "Pertanyaan dan jawaban wajib diisi" }, 422);
  const norm = normalizePrompt(prompt);
  const dup = await env.DB.prepare("SELECT id FROM examples WHERE prompt_norm = ?").bind(norm).first();
  if (dup) return json({ added: 0, duplicate: true });
  const r = await env.DB.prepare(
    "INSERT INTO examples (prompt, prompt_norm, answer, source) VALUES (?, ?, ?, ?)"
  ).bind(prompt, norm, answer, source).run();
  return json({ added: 1, id: r.meta ? r.meta.last_row_id : null });
}
__name(onRequestPost3, "onRequestPost3");
__name2(onRequestPost3, "onRequestPost");
async function onRequestPatch2({ request, env }) {
  if (!await rateLimit(env.DB, request)) return json({ error: "Terlalu banyak aksi \u2014 tunggu sebentar lagi" }, 429);
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const id = Number(body.id || 0);
  if (!id) return json({ error: "id wajib" }, 422);
  const row = await env.DB.prepare("SELECT id FROM examples WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Data tidak ditemukan" }, 404);
  const sets = [];
  const args = [];
  if (body.rating !== void 0) {
    const r = Number(body.rating);
    if (r !== -1 && r !== 0 && r !== 1) return json({ error: "Nilai rating harus -1, 0, atau 1" }, 422);
    sets.push("rating = ?");
    args.push(r);
  }
  if (body.prompt !== void 0) {
    const p = String(body.prompt || "").trim().slice(0, 2e3);
    if (p.length < 3) return json({ error: "Pertanyaan terlalu pendek" }, 422);
    sets.push("prompt = ?");
    args.push(p);
    sets.push("prompt_norm = ?");
    args.push(normalizePrompt(p));
  }
  if (body.answer !== void 0) {
    const a = String(body.answer || "").trim().slice(0, 8e3);
    if (!a) return json({ error: "Jawaban tidak boleh kosong" }, 422);
    sets.push("answer = ?");
    args.push(a);
  }
  if (body.source !== void 0) {
    sets.push("source = ?");
    args.push(body.source === "model" ? "model" : "manusia");
  }
  if (!sets.length) return json({ error: "Tidak ada perubahan" }, 422);
  sets.push("updated_at = datetime('now')");
  await env.DB.prepare("UPDATE examples SET " + sets.join(", ") + " WHERE id = ?").bind(...args, id).run();
  return json({ ok: true });
}
__name(onRequestPatch2, "onRequestPatch2");
__name2(onRequestPatch2, "onRequestPatch");
async function onRequestDelete({ request, env }) {
  if (!await rateLimit(env.DB, request)) return json({ error: "Terlalu banyak aksi \u2014 tunggu sebentar lagi" }, 429);
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const id = Number(body.id || 0);
  if (!id) return json({ error: "id wajib" }, 422);
  await env.DB.prepare("DELETE FROM examples WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
__name(onRequestDelete, "onRequestDelete");
__name2(onRequestDelete, "onRequestDelete");
async function onRequestOptions4() {
  return corsPreflight();
}
__name(onRequestOptions4, "onRequestOptions4");
__name2(onRequestOptions4, "onRequestOptions");
var SYSTEM = 'Kamu adalah guru penyusun data latihan untuk model kecil bernama Model A (asisten chat bernama Clincoo). Jawab pertanyaan pengguna secara ringkas, akurat, dan berstruktur (poin-poin bila perlu), dalam bahasa Indonesia yang natural. Jawabanmu akan langsung dipakai model kecil, jadi tulis jawaban final yang berdiri sendiri, tanpa membuka "Tentu!" atau tanya balik.';
async function tryOpenRouter(key, prompt) {
  const models = ["openai/gpt-6-luna-pro", "openai/gpt-6.1-sol-pro", "z-ai/glm-5.3-flash"];
  for (const model of models) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key, "HTTP-Referer": "https://www.clinqoo.biz.id", "X-Title": "Clincoo Model A" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: prompt }
          ]
        })
      });
      const data = await res.json().catch(() => ({}));
      console.log("gen:or", model, res.status);
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (res.ok && text) return { answer: String(text).trim(), model: model.split("/").pop() + " (OpenRouter)" };
    } catch (e) {
    }
  }
  return null;
}
__name(tryOpenRouter, "tryOpenRouter");
__name2(tryOpenRouter, "tryOpenRouter");
async function tryGemini(key, prompt) {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash"];
  for (const model of models) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        })
      });
      const data = await res.json().catch(() => ({}));
      console.log("gen:gem", model, res.status);
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      const text = parts && parts.map((p) => p.text || "").join("");
      if (res.ok && text) return { answer: String(text).trim(), model: model + " (Gemini)" };
    } catch (e) {
    }
  }
  return null;
}
__name(tryGemini, "tryGemini");
__name2(tryGemini, "tryGemini");
async function onRequestPost4({ request, env }) {
  console.log("gen:start");
  if (!await rateLimit(env.DB, request, 15, 60)) return json({ error: "Terlalu banyak permintaan \u2014 tunggu sebentar" }, 429);
  await ensureTables(env.DB);
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
  }
  const prompt = String(body.prompt || "").trim().slice(0, 2e3);
  const autoSave = body.auto_save !== false;
  if (!prompt) return json({ error: "Pertanyaan wajib diisi" }, 422);
  let gen = null;
  console.log("gen:keys", !!env.OPENROUTER_KEY, !!env.GEMINI_KEY);
  if (env.OPENROUTER_KEY) gen = await tryOpenRouter(env.OPENROUTER_KEY, prompt);
  if (!gen && env.GEMINI_KEY) gen = await tryGemini(env.GEMINI_KEY, prompt);
  console.log("gen:result", gen ? gen.model : "null");
  if (!gen) return json({ error: "Guru AI belum bisa dihubungi \u2014 coba lagi sebentar" }, 502);
  let saved = { saved: 0, id: null };
  if (autoSave) {
    const norm = normalizePrompt(prompt);
    const dup = await env.DB.prepare("SELECT id FROM examples WHERE prompt_norm = ?").bind(norm).first();
    if (dup) {
      await env.DB.prepare("UPDATE examples SET answer = ?, source = 'model', rating = 0, updated_at = datetime('now') WHERE id = ?").bind(gen.answer.slice(0, 8e3), dup.id).run();
      saved = { saved: 1, updated: 1, id: dup.id };
    } else {
      const r = await env.DB.prepare("INSERT INTO examples (prompt, prompt_norm, answer, source) VALUES (?, ?, ?, 'model')").bind(prompt, norm, gen.answer.slice(0, 8e3)).run();
      saved = { saved: 1, id: r.meta ? r.meta.last_row_id : null };
    }
  }
  return json({ answer: gen.answer, model: gen.model, saved });
}
__name(onRequestPost4, "onRequestPost4");
__name2(onRequestPost4, "onRequestPost");
async function onRequestOptions5() {
  return corsPreflight();
}
__name(onRequestOptions5, "onRequestOptions5");
__name2(onRequestOptions5, "onRequestOptions");
async function onRequestGet2({ env }) {
  await ensureTables(env.DB);
  const ex = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN source = 'model' THEN 1 ELSE 0 END) AS from_model FROM examples"
  ).first();
  const chat = await env.DB.prepare("SELECT COUNT(*) AS total FROM chat_log").first();
  return json({
    examples: ex && ex.total || 0,
    approved: ex && ex.approved || 0,
    from_model: ex && ex.from_model || 0,
    chats: chat && chat.total || 0
  });
}
__name(onRequestGet2, "onRequestGet2");
__name2(onRequestGet2, "onRequestGet");
var routes = [
  {
    routePath: "/v1/chat/completions",
    mountPath: "/v1/chat",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/v1/chat/completions",
    mountPath: "/v1/chat",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/chat",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions2]
  },
  {
    routePath: "/api/chat",
    mountPath: "/api",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch]
  },
  {
    routePath: "/api/chat",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions3]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch2]
  },
  {
    routePath: "/api/data",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/generate",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions4]
  },
  {
    routePath: "/api/generate",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/stats",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/stats",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions5]
  }
];
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
__name2(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name2(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name2(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name2(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name2(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name2(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
__name2(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
__name2(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name2(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
__name2(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
__name2(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
__name2(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
__name2(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
__name2(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
__name2(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
__name2(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");
__name2(pathToRegexp, "pathToRegexp");
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
__name2(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name2((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
__name2(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
__name2(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
__name2(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");
__name2(__facade_invoke__, "__facade_invoke__");
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  static {
    __name(this, "___Facade_ScheduledController__");
  }
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name2(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
__name2(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name2((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name2((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
__name2(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// ../../../../usr/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default2 = drainBody2;

// ../../../../usr/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause)
  };
}
__name(reduceError2, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-SAQzNN/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2
];
var middleware_insertion_facade_default2 = middleware_loader_entry_default;

// ../../../../usr/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, "__facade_register__");
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, "__facade_invokeChain__");
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [
    ...__facade_middleware__2,
    finalMiddleware
  ]);
}
__name(__facade_invoke__2, "__facade_invoke__");

// .wrangler/tmp/bundle-SAQzNN/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class ___Facade_ScheduledController__2 {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__2)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler2, "wrapExportedHandler");
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__2(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint2, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === "object") {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === "function") {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default
};
//# sourceMappingURL=functionsWorker-0.23701449572585687.js.map

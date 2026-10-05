// Clincoo — mesin obrolan: pertanyaan dicocokkan ke data latihan (retrieval + skor),
// di bawah ambang kemiripan Clincoo jujur mengaku belum dilatih.
import { json, corsPreflight, ensureTables, rateLimit, bestMatch, MATCH_THRESHOLD, askGuruAI, saveTraining, smallTalkReply } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

const FALLBACK = 'Aku belum dilatih untuk pertanyaan itu, jadi aku tidak akan menebak. Ajari aku lewat Playground di situs ini: tulis pertanyaan beserta jawaban terbaiknya, dan aku akan bisa menjawabnya di chat ini.';

// Identitas asisten: pertanyaan "kamu siapa / nama kamu apa" dijawab langsung,
// tidak bergantung data latihan.
const IDENTITY_ANSWER = 'Aku Clincoo AI, asisten superagent dari Clincoo, ditenagai Vy-1, model distilasi buatan Vylonium. Aku bukan chatbot pasif — aku rekan yang suka menjelaskan dengan detail, contoh, dan analogi sampai kamu benar-benar paham. Aku terus belajar dari setiap obrolan: pengetahuanku tumbuh dari pelajaran terkurasi dan yang kucari sendiri, jadi makin sering kita ngobrol makin paham aku soal kebutuhanmu. Kalau ada hal yang belum kutahu, aku jujur bilang dan langsung kupelajari saat itu juga. Silakan tanya apa saja, dari pengetahuan umum sampai cuma obrolan santai.';
function isIdentityQuestion(message) {
  const q = String(message || '').toLowerCase();
  if (/who are you|perkenalkan diri|perkenalkan dirimu/.test(q)) return true;
  return /(siapa|nama|sebut).{0,24}(kamu|namamu|nama kamu|kau|anda|lo|lu)(\b|$)/.test(q)
    || /(pakai|pake) (model|mesin|ai|apa)/.test(q)
    || /model (apa|siapa|punya siapa)/.test(q)
    || /^(kamu|kaau|u) (ini )?(siapa|apa)/.test(q)
    || /^(siapa|apa) (sih )?(kamu|namamu)/.test(q);
}

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env.DB, request, 30, 60))) return json({ error: 'Terlalu banyak pesan — tunggu sebentar lagi' }, 429);
  await ensureTables(env.DB);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const messagesIn = Array.isArray(body.messages) ? body.messages : null;
  let message = String(body.message || '').trim().slice(0, 2000);
  if (!message && messagesIn) {
    // Protokol halaman chat Clincoo: ambil teks pesan user terakhir dari array messages
    for (let i = messagesIn.length - 1; i >= 0; i--) {
      const m = messagesIn[i];
      if (!m || m.role !== 'user') continue;
      const c = m.content;
      const t = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(p => p && p.type === 'text' && typeof p.text === 'string').map(p => p.text).join(' ') : '');
      message = t.trim().slice(0, 2000);
      break;
    }
  }
  if (!message) return json({ error: 'Pesan kosong' }, 422);

  const rows = await env.DB.prepare(
    'SELECT id, prompt, answer, source, rating FROM examples WHERE rating != -1 ORDER BY id DESC LIMIT 2000'
  ).all();
  const examples = rows && rows.results ? rows.results : [];

  let reply, matchedId = null, score = 0, matchedPrompt = null, source = null;
  let tutored = false, tutorModel = null;
  if (isIdentityQuestion(message)) {
    reply = IDENTITY_ANSWER;
    source = 'identitas';
    matchedPrompt = '(identitas bawaan)';
  } else if (smallTalkReply(message)) {
    reply = smallTalkReply(message);
    source = 'smalltalk';
    matchedPrompt = '(sapaan bawaan)';
  } else {
  // Guru AI bekerja di LATAR BELAKANG (tanpa toggle publik): kalau ingatan
  // belum tahu, Clincoo diam-diam "chatan" dengan guru AI (Gemini/OpenRouter),
  // jawabannya langsung disimpan sebagai ingatan baru — seperti AI pada umumnya.
  const match = bestMatch(message, examples);
  if (match && match.score >= MATCH_THRESHOLD) {
    matchedId = match.example.id;
    score = Math.round(match.score * 100) / 100;
    matchedPrompt = match.example.prompt;
    source = match.example.source;
    // Jawaban dari ingatan ditulis ulang dulu biar terdengar natural, bukan template.
    const gen = await askGuruAI(env, message, match.example.answer);
    if (gen) {
      reply = gen.answer;
    } else {
      reply = match.example.answer; // guru sibuk → pakai ingatan mentah
    }
  } else {
    const gen = await askGuruAI(env, message);
    if (gen) {
      reply = gen.answer;
      tutored = true;
      tutorModel = gen.model;
      source = 'model';
      matchedPrompt = '(baru dilatih oleh guru AI)';
      const saved = await saveTraining(env.DB, message, gen.answer);
      matchedId = saved && saved.id ? saved.id : null;
    } else {
      // Guru AI tidak bisa dihubungi → jujur mengaku belum bisa.
      reply = FALLBACK;
    }
  }
  }

  const log = await env.DB.prepare(
    'INSERT INTO chat_log (question, reply, matched_id, score) VALUES (?, ?, ?, ?)'
  ).bind(message.slice(0, 500), reply.slice(0, 500), matchedId, score).run();

  if (messagesIn) {
    // Respons format halaman chat Clincoo: {text, session_id} (halaman membaca .text)
    return json({ text: reply, session_id: body.session_id || undefined, trained: matchedId != null || tutored, tutored: tutored, model: tutorModel, match: matchedPrompt ? { prompt: matchedPrompt, score: score, source: source } : null });
  }
  return json({
    id: log.meta ? log.meta.last_row_id : null,
    reply: reply,
    trained: matchedId != null || tutored,
    tutored: tutored,
    model: tutorModel,
    match: matchedPrompt ? { prompt: matchedPrompt, score: score, source: source } : null
  });
}

// Umpan balik manusia atas jawaban (thumbs up/down) → disimpan ke chat_log,
// jadi pemilik bisa lihat mana jawaban yang perlu diperbaiki di Playground.
export async function onRequestPatch({ request, env }) {
  if (!(await rateLimit(env.DB, request, 60, 60))) return json({ error: 'Terlalu banyak aksi' }, 429);
  await ensureTables(env.DB);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const id = Number(body.id || 0);
  const rating = Number(body.rating || 0);
  if (!id || (rating !== -1 && rating !== 1)) return json({ error: 'id dan rating (1/-1) wajib' }, 422);
  await env.DB.prepare('UPDATE chat_log SET feedback = ? WHERE id = ?').bind(rating, id).run();
  return json({ ok: true });
}

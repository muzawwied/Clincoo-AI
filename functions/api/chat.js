// Model A — mesin obrolan: pertanyaan dicocokkan ke data latihan (retrieval + skor),
// di bawah ambang kemiripan Model A jujur mengaku belum dilatih.
import { json, corsPreflight, ensureTables, rateLimit, bestMatch, MATCH_THRESHOLD } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

const FALLBACK = 'Aku belum dilatih untuk pertanyaan itu, jadi aku tidak akan menebak. Ajari aku lewat Playground di situs ini: tulis pertanyaan beserta jawaban terbaiknya, dan aku akan bisa menjawabnya di chat ini.';

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env.DB, request, 30, 60))) return json({ error: 'Terlalu banyak pesan — tunggu sebentar lagi' }, 429);
  await ensureTables(env.DB);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const message = String(body.message || '').trim().slice(0, 2000);
  if (!message) return json({ error: 'Pesan kosong' }, 422);

  const rows = await env.DB.prepare(
    'SELECT id, prompt, answer, source, rating FROM examples WHERE rating != -1 ORDER BY id DESC LIMIT 2000'
  ).all();
  const examples = rows && rows.results ? rows.results : [];
  const match = bestMatch(message, examples);

  let reply, matchedId = null, score = 0, matchedPrompt = null, source = null;
  if (match && match.score >= MATCH_THRESHOLD) {
    reply = match.example.answer;
    matchedId = match.example.id;
    score = Math.round(match.score * 100) / 100;
    matchedPrompt = match.example.prompt;
    source = match.example.source;
  } else {
    reply = FALLBACK;
  }

  const log = await env.DB.prepare(
    'INSERT INTO chat_log (question, reply, matched_id, score) VALUES (?, ?, ?, ?)'
  ).bind(message.slice(0, 500), reply.slice(0, 500), matchedId, score).run();

  return json({
    id: log.meta ? log.meta.last_row_id : null,
    reply: reply,
    trained: matchedId != null,
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

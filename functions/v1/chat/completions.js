// Model A — endpoint kompatibel OpenAI (POST /v1/chat/completions) untuk
// integrasi mudah: kirim messages, dapatkan jawaban Model A.
import { json, corsPreflight, ensureTables, rateLimit, bestMatch, MATCH_THRESHOLD } from '../../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env.DB, request, 30, 60))) return json({ error: { message: 'Terlalu banyak permintaan' } }, 429);
  await ensureTables(env.DB);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find(m => m && m.role === 'user');
  const question = String((lastUser && lastUser.content) || '').trim().slice(0, 2000);
  if (!question) return json({ error: { message: 'Pesan pengguna tidak ditemukan' } }, 422);

  const rows = await env.DB.prepare(
    'SELECT id, prompt, answer, source, rating FROM examples WHERE rating != -1 ORDER BY id DESC LIMIT 2000'
  ).all();
  const examples = rows && rows.results ? rows.results : [];
  const match = bestMatch(question, examples);
  const reply = (match && match.score >= MATCH_THRESHOLD) ? match.example.answer : null;

  await env.DB.prepare('INSERT INTO chat_log (question, reply, matched_id, score) VALUES (?, ?, ?, ?)')
    .bind(question.slice(0, 500), (reply || '').slice(0, 500), reply ? match.example.id : null, match ? Math.round(match.score * 100) / 100 : 0).run();

  const now = Math.floor(Date.now() / 1000);
  return json({
    id: 'chatcmpl-modela-' + now,
    object: 'chat.completion',
    created: now,
    model: body.model || 'model-a',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: reply || 'Model A belum dilatih untuk pertanyaan ini. Tambahkan jawabannya lewat Playground.' },
      finish_reason: reply ? 'stop' : 'no_match'
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

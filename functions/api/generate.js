// Generator pelatihan (dipakai Playground): minta jawaban "guru" dari AI besar
// dan otomatis SIMPAN jawaban itu sebagai data latihan Clincoo (source 'model').
// Kunci API hanya di server (env), tidak pernah sampai ke browser.
import { json, corsPreflight, rateLimit, ensureTables, normalizePrompt, askGuruAI, saveTraining } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env.DB, request, 15, 60))) return json({ error: 'Terlalu banyak permintaan — tunggu sebentar' }, 429);
  await ensureTables(env.DB);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const prompt = String(body.prompt || '').trim().slice(0, 2000);
  const autoSave = body.auto_save !== false; // default: simpan otomatis
  if (!prompt) return json({ error: 'Pertanyaan wajib diisi' }, 422);

  const gen = await askGuruAI(env, prompt);
  if (!gen) return json({ error: 'Guru AI belum bisa dihubungi — coba lagi sebentar' }, 502);

  let saved = { saved: 0, id: null };
  if (autoSave) saved = await saveTraining(env.DB, prompt, gen.answer);

  return json({ answer: gen.answer, model: gen.model, saved: saved });
}

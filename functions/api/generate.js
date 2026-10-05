// Generator pelatihan: minta jawaban "guru" dari AI besar (OpenRouter dulu,
// lalu Gemini), dan otomatis SIMPAN jawaban itu sebagai data latihan Clincoo
// (source 'model') — jadi Clincoo langsung "mengingat" hasil pelatihan ini.
// Kunci API hanya di server (env), tidak pernah sampai ke browser.
import { json, corsPreflight, rateLimit, ensureTables, normalizePrompt } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

const SYSTEM = 'Kamu adalah guru penyusun data latihan untuk model kecil bernama Clincoo. Jawab pertanyaan pengguna secara ringkas, akurat, dan berstruktur (poin-poin bila perlu), dalam bahasa Indonesia yang natural. Jawabanmu akan langsung dipakai model kecil, jadi tulis jawaban final yang berdiri sendiri, tanpa membuka "Tentu!" atau tanya balik.';

async function tryOpenRouter(key, prompt) {
  const models = ['openai/gpt-6-luna-pro', 'openai/gpt-6.1-sol-pro', 'z-ai/glm-5.3-flash'];
  for (const model of models) {
    try {
      
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'HTTP-Referer': 'https://www.clinqoo.biz.id', 'X-Title': 'Clincoo' },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: prompt }
          ]
        })
      });
      const data = await res.json().catch(() => ({}));
      console.log('gen:or', model, res.status);
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (res.ok && text) return { answer: String(text).trim(), model: model.split('/').pop() + ' (OpenRouter)' };
      console.log('gen:or-fail', model, res.status);
    } catch (e) { console.log('gen:or-err', model, e && e.message); }
  }
  return null;
}

async function tryGemini(key, prompt) {
  const models = ['gemini-3.6-flash', 'gemini-3-flash-preview'];
  for (const model of models) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        })
      });
      const data = await res.json().catch(() => ({}));
      console.log('gen:gem', model, res.status);
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      const text = parts && parts.map(p => p.text || '').join('');
      if (res.ok && text) return { answer: String(text).trim(), model: model + ' (Gemini)' };
    } catch (e) { /* coba model berikutnya */ }
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  console.log('gen:start');
  if (!(await rateLimit(env.DB, request, 15, 60))) return json({ error: 'Terlalu banyak permintaan — tunggu sebentar' }, 429);
  await ensureTables(env.DB);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const prompt = String(body.prompt || '').trim().slice(0, 2000);
  const autoSave = body.auto_save !== false; // default: simpan otomatis
  if (!prompt) return json({ error: 'Pertanyaan wajib diisi' }, 422);

  // Rantai guru AI: OpenRouter → Gemini
  let gen = null;
  console.log('gen:keys', !!env.OPENROUTER_KEY, !!env.GEMINI_KEY);
  if (env.OPENROUTER_KEY) gen = await tryOpenRouter(env.OPENROUTER_KEY, prompt);
  if (!gen && env.GEMINI_KEY) gen = await tryGemini(env.GEMINI_KEY, prompt);
  console.log('gen:result', gen ? gen.model : 'null');
  if (!gen) return json({ error: 'Guru AI belum bisa dihubungi — coba lagi sebentar' }, 502);

  // Simpan jawaban pelatihan sebagai data latihan — Clincoo langsung mengingatnya.
  // Duplikat pertanyaan tetap diperbarui supaya versi terbaru yang dipakai.
  let saved = { saved: 0, id: null };
  if (autoSave) {
    const norm = normalizePrompt(prompt);
    const dup = await env.DB.prepare('SELECT id FROM examples WHERE prompt_norm = ?').bind(norm).first();
    if (dup) {
      await env.DB.prepare("UPDATE examples SET answer = ?, source = 'model', rating = 0, updated_at = datetime('now') WHERE id = ?").bind(gen.answer.slice(0, 8000), dup.id).run();
      saved = { saved: 1, updated: 1, id: dup.id };
    } else {
      const r = await env.DB.prepare("INSERT INTO examples (prompt, prompt_norm, answer, source) VALUES (?, ?, ?, 'model')").bind(prompt, norm, gen.answer.slice(0, 8000)).run();
      saved = { saved: 1, id: r.meta ? r.meta.last_row_id : null };
    }
  }

  return json({ answer: gen.answer, model: gen.model, saved: saved });
}

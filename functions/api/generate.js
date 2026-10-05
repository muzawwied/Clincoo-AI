// Model A — generator data dari model besar: Playground memanggil ini untuk
// meminta jawaban "guru" (model besar) yang nanti dikurasi manusia sebelum
// masuk data latihan. Kunci API disimpan server-side (env), tidak pernah
// sampai ke browser.
import { json, corsPreflight, rateLimit } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env.DB, request, 15, 60))) return json({ error: 'Terlalu banyak permintaan — tunggu sebentar' }, 429);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const prompt = String(body.prompt || '').trim().slice(0, 2000);
  if (!prompt) return json({ error: 'Pertanyaan wajib diisi' }, 422);

  const key = env.MODEL_BIG_KEY || '';
  const url = env.MODEL_BIG_URL || 'https://app.clincoo.buzz/v1/chat/completions';
  if (!key) return json({ error: 'Model besar belum dihubungkan — atur MODEL_BIG_KEY di environment situs ini' }, 503);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-6-luna-pro',
        messages: [
          { role: 'system', content: 'Kamu adalah guru penyusun data latihan untuk model kecil bernama Model A. Jawab pertanyaan pengguna secara ringkas, akurat, dan berstruktur (poin-poin bila perlu), dalam bahasa Indonesia yang natural. Jawabanmu akan dikurasi manusia sebelum dipakai melatih model kecil.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await res.json();
    const answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!answer) return json({ error: 'Model besar tidak mengembalikan jawaban' }, 502);
    return json({ answer: String(answer).trim(), model: (data.model || 'model-besar') });
  } catch (e) {
    return json({ error: 'Gagal menghubungi model besar — coba lagi' }, 502);
  }
}

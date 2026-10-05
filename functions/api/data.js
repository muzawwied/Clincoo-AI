// Model A — API data latihan (Playground): daftar, tambah, nilai, edit, hapus.
import { json, corsPreflight, ensureTables, rateLimit, normalizePrompt } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ request, env }) {
  await ensureTables(env.DB);
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  let rows;
  if (q) {
    rows = await env.DB.prepare(
      "SELECT id, prompt, answer, source, rating, created_at FROM examples WHERE LOWER(prompt) LIKE ? OR LOWER(answer) LIKE ? ORDER BY id DESC LIMIT 200"
    ).bind('%' + q + '%', '%' + q + '%').all();
  } else {
    rows = await env.DB.prepare(
      'SELECT id, prompt, answer, source, rating, created_at FROM examples ORDER BY id DESC LIMIT 200'
    ).all();
  }
  const totals = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) AS rejected, SUM(CASE WHEN source = 'model' THEN 1 ELSE 0 END) AS from_model FROM examples"
  ).first();
  const items = (rows && rows.results ? rows.results : []).map(r => ({
    id: r.id, prompt: r.prompt, answer: r.answer, source: r.source || 'manusia', rating: r.rating || 0, created_at: r.created_at
  }));
  return json({
    items: items,
    total: (totals && totals.total) || 0,
    approved: (totals && totals.approved) || 0,
    rejected: (totals && totals.rejected) || 0,
    from_model: (totals && totals.from_model) || 0
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env.DB, request))) return json({ error: 'Terlalu banyak aksi — tunggu sebentar lagi' }, 429);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const prompt = String(body.prompt || '').trim().slice(0, 2000);
  const answer = String(body.answer || '').trim().slice(0, 8000);
  const source = (body.source === 'model') ? 'model' : 'manusia';
  if (prompt.length < 3 || answer.length < 1) return json({ error: 'Pertanyaan dan jawaban wajib diisi' }, 422);
  const norm = normalizePrompt(prompt);
  const dup = await env.DB.prepare('SELECT id FROM examples WHERE prompt_norm = ?').bind(norm).first();
  if (dup) return json({ added: 0, duplicate: true });
  const r = await env.DB.prepare(
    'INSERT INTO examples (prompt, prompt_norm, answer, source) VALUES (?, ?, ?, ?)'
  ).bind(prompt, norm, answer, source).run();
  return json({ added: 1, id: r.meta ? r.meta.last_row_id : null });
}

export async function onRequestPatch({ request, env }) {
  if (!(await rateLimit(env.DB, request))) return json({ error: 'Terlalu banyak aksi — tunggu sebentar lagi' }, 429);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const id = Number(body.id || 0);
  if (!id) return json({ error: 'id wajib' }, 422);
  const row = await env.DB.prepare('SELECT id FROM examples WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Data tidak ditemukan' }, 404);

  const sets = [];
  const args = [];
  if (body.rating !== undefined) {
    const r = Number(body.rating);
    if (r !== -1 && r !== 0 && r !== 1) return json({ error: 'Nilai rating harus -1, 0, atau 1' }, 422);
    sets.push('rating = ?'); args.push(r);
  }
  if (body.prompt !== undefined) {
    const p = String(body.prompt || '').trim().slice(0, 2000);
    if (p.length < 3) return json({ error: 'Pertanyaan terlalu pendek' }, 422);
    sets.push('prompt = ?'); args.push(p);
    sets.push('prompt_norm = ?'); args.push(normalizePrompt(p));
  }
  if (body.answer !== undefined) {
    const a = String(body.answer || '').trim().slice(0, 8000);
    if (!a) return json({ error: 'Jawaban tidak boleh kosong' }, 422);
    sets.push('answer = ?'); args.push(a);
  }
  if (body.source !== undefined) {
    sets.push('source = ?'); args.push(body.source === 'model' ? 'model' : 'manusia');
  }
  if (!sets.length) return json({ error: 'Tidak ada perubahan' }, 422);
  sets.push("updated_at = datetime('now')");
  await env.DB.prepare('UPDATE examples SET ' + sets.join(', ') + ' WHERE id = ?').bind(...args, id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await rateLimit(env.DB, request))) return json({ error: 'Terlalu banyak aksi — tunggu sebentar lagi' }, 429);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const id = Number(body.id || 0);
  if (!id) return json({ error: 'id wajib' }, 422);
  await env.DB.prepare('DELETE FROM examples WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

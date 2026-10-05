// Clincoo — dataset pengetahuan sebagai file JSON unduhan.
import { corsPreflight, ensureTables } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ env }) {
  await ensureTables(env.DB);
  const rows = await env.DB.prepare(
    'SELECT id, prompt, answer, source, rating, created_at FROM examples ORDER BY id ASC'
  ).all();
  const items = (rows && rows.results ? rows.results : []).map(r => ({
    id: r.id, prompt: r.prompt, answer: r.answer, source: r.source || 'manusia', rating: r.rating || 0, created_at: r.created_at
  }));
  const body = JSON.stringify({ dataset: 'Clincoo AI Knowledge', version: new Date().toISOString().slice(0, 10), total: items.length, items }, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="clincoo-dataset.json"',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

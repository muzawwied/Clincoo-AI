// Clincoo — statistik publik untuk halaman landing.
import { json, corsPreflight, ensureTables } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ env }) {
  await ensureTables(env.DB);
  const ex = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN source = 'model' THEN 1 ELSE 0 END) AS from_model FROM examples"
  ).first();
  const chat = await env.DB.prepare('SELECT COUNT(*) AS total FROM chat_log').first();
  return json({
    examples: (ex && ex.total) || 0,
    approved: (ex && ex.approved) || 0,
    from_model: (ex && ex.from_model) || 0,
    chats: (chat && chat.total) || 0
  });
}

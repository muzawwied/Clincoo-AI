// Clincoo AI — [Realtime] snapshot bersama untuk semua halaman & perangkat.
// GET /api/sync            -> { rev, contoh, chat, dsb }
// GET /api/sync?since=REV  -> { changed: true|false, ... } (ringan untuk polling)
import { json, corsPreflight, syncSnapshot } from '../helpers.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const since = String(u.searchParams.get('since') || '').trim();
  const snap = await syncSnapshot(env.DB);
  if (since && since === snap.rev) {
    return json({ changed: false, rev: snap.rev }, 200);
  }
  return json({ changed: true, ...snap });
}

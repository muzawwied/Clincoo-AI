// Clincoo — Server MCP (Model Context Protocol) atas pengetahuan Clincoo AI.
// Transport: Streamable HTTP (stateless) di POST /mcp — respons JSON biasa.
// Dipakai app chat AI lain (Claude Desktop dsb.) untuk full akses:
// tanya ke pengetahuan, cari data latihan, tambah pengetahuan, hapus.
// Kunci akses: env.MCP_TOKEN (Bearer). Jika kosong, endpoint ditutup.
import { json, ensureTables, rateLimit, normalizePrompt, bestMatch, MATCH_THRESHOLD } from './helpers.js';

const PROTOCOL = '2025-03-26';
const SERVER_INFO = { name: 'clincoo-ai-knowledge', version: '1.0.0' };

const TOOLS = [
  {
    name: 'clincoo_ask',
    description: 'Tanya sesuatu ke asisten AI Clincoo. Menggunakan mesin retrieval Clincoo (BM25-lite) atas data latihan terkurasi. Kalau pertanyaan belum ada di pengetahuan, Clincoo jujur bilang belum dilatih (tidak menebak).',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'Pertanyaan dalam bahasa apa pun' } },
      required: ['question']
    }
  },
  {
    name: 'clincoo_search',
    description: 'Cari data latihan Clincoo yang paling mirip dengan sebuah teks, lengkap dengan skor kemiripan. Berguna untuk memeriksa apa yang sudah diketahui Clincoo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Teks kunci pencarian' },
        limit: { type: 'number', description: 'Jumlah hasil maksimum (default 10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'clincoo_add',
    description: 'Tambah satu pasangan pengetahuan baru (pertanyaan + jawaban) ke data latihan Clincoo. Setelah ditambah, Clincoo langsung bisa menjawab pertanyaan itu di chat dan via MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Pertanyaan / pemicu' },
        answer: { type: 'string', description: 'Jawaban terbaik' },
        source: { type: 'string', description: 'Sumber data: manual (default) atau nama model/app AI yang menyumbang' }
      },
      required: ['prompt', 'answer']
    }
  },
  {
    name: 'clincoo_list',
    description: 'Lihat daftar data latihan Clincoo terbaru (id, pertanyaan, jawaban, sumber, rating).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Jumlah baris (default 20, maks 100)' } }
    }
  },
  {
    name: 'clincoo_delete',
    description: 'Hapus satu data latihan Clincoo berdasarkan id (full akses). Hati-hati: tidak bisa dibatalkan.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'id data latihan (lihat dari clincoo_list)' } },
      required: ['id']
    }
  }
];

function rpcResult(id, result) {
  return json({ jsonrpc: '2.0', id: id, result: result });
}
function rpcError(id, code, message) {
  return json({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
}

async function handleToolsCall(env, name, args) {
  if (name === 'clincoo_ask') {
    const q = String((args && args.question) || '').trim();
    if (!q) return { error: { code: -32602, message: 'question wajib diisi' } };
    const rows = await env.DB.prepare(
      'SELECT id, prompt, answer, source, rating FROM examples WHERE rating != -1 ORDER BY id DESC LIMIT 2000'
    ).all();
    const examples = rows && rows.results ? rows.results : [];
    const match = bestMatch(q, examples);
    if (match && match.score >= MATCH_THRESHOLD) {
      return { content: [{ type: 'text', text: match.example.answer }], structuredContent: { answer: match.example.answer, matched: true, score: Math.round(match.score * 100) / 100, source: match.example.source, prompt: match.example.prompt, id: match.example.id } };
    }
    return { content: [{ type: 'text', text: 'Clincoo belum dilatih untuk pertanyaan ini, jadi ia tidak menebak. Gunakan clincoo_add untuk mengajari jawabannya.' }], structuredContent: { answer: null, matched: false } };
  }
  if (name === 'clincoo_search') {
    const q = String((args && args.query) || '').trim();
    if (!q) return { error: { code: -32602, message: 'query wajib diisi' } };
    const limit = Math.max(1, Math.min(Number((args && args.limit) || 10), 50));
    const rows = await env.DB.prepare(
      'SELECT id, prompt, answer, source, rating FROM examples WHERE rating != -1 ORDER BY id DESC LIMIT 2000'
    ).all();
    const examples = rows && rows.results ? rows.results : [];
    const scored = examples
      .map(function (ex) { const m = bestMatch(q, [ex]); return { id: ex.id, prompt: ex.prompt, answer: ex.answer, source: ex.source, score: m ? Math.round(m.score * 100) / 100 : 0 }; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, limit);
    return { content: [{ type: 'text', text: JSON.stringify(scored) }] };
  }
  if (name === 'clincoo_add') {
    const prompt = String((args && args.prompt) || '').trim();
    const answer = String((args && args.answer) || '').trim();
    if (!prompt || !answer) return { error: { code: -32602, message: 'prompt dan answer wajib diisi' } };
    const source = String((args && args.source) || 'manual').slice(0, 40);
    const np = normalizePrompt(prompt);
    const dup = await env.DB.prepare('SELECT id FROM examples WHERE prompt_norm = ?').bind(np).first();
    if (dup) return { content: [{ type: 'text', text: 'Data latihan dengan pertanyaan itu sudah ada (id ' + dup.id + ').' }], structuredContent: { added: false, id: dup.id } };
    const res = await env.DB.prepare(
      'INSERT INTO examples (prompt, prompt_norm, answer, source) VALUES (?, ?, ?, ?)'
    ).bind(prompt.slice(0, 1000), np, answer.slice(0, 8000), source).run();
    const id = res.meta ? res.meta.last_row_id : null;
    return { content: [{ type: 'text', text: 'Pengetahuan baru ditambahkan (id ' + id + '). Clincoo sekarang bisa menjawabnya.' }], structuredContent: { added: true, id: id } };
  }
  if (name === 'clincoo_list') {
    const limit = Math.max(1, Math.min(Number((args && args.limit) || 20), 100));
    const rows = await env.DB.prepare(
      'SELECT id, prompt, answer, source, rating FROM examples ORDER BY id DESC LIMIT ?'
    ).bind(limit).all();
    return { content: [{ type: 'text', text: JSON.stringify(rows && rows.results ? rows.results : []) }] };
  }
  if (name === 'clincoo_delete') {
    const id = Number(args && args.id);
    if (!id) return { error: { code: -32602, message: 'id wajib berupa angka' } };
    await env.DB.prepare('DELETE FROM examples WHERE id = ?').bind(id).run();
    return { content: [{ type: 'text', text: 'Data latihan id ' + id + ' dihapus.' }], structuredContent: { deleted: true, id: id } };
  }
  return { error: { code: -32602, message: 'Tool tidak dikenal: ' + name } };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id'
    }
  });
}

// Streamable HTTP stateless: GET untuk SSE stream tidak didukung (405).
export async function onRequestGet() {
  return new Response(null, { status: 405, headers: { 'Allow': 'POST, OPTIONS' } });
}
export async function onRequestDelete() {
  return new Response(null, { status: 204 });
}

export async function onRequestPost({ request, env }) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id'
  };
  const wrap = function (response) {
    const r = new Response(response.body, response);
    Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
    return r;
  };

  // Kunci akses: wajib ada MCP_TOKEN di env, dan client harus membawa Bearer yang sama.
  const token = env.MCP_TOKEN || '';
  if (!token) return wrap(json({ error: 'Server MCP belum dikonfigurasi (MCP_TOKEN belum diset)' }, 503));
  const auth = request.headers.get('Authorization') || '';
  // Token boleh lewat header Bearer ATAU langsung di URL (?token=...) —
  // jadi satu URL saja sudah membawa full izin (praktis untuk client MCP).
  const urlToken = new URL(request.url).searchParams.get('token') || '';
  if (auth !== 'Bearer ' + token && urlToken !== token) return wrap(json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: kirim header Authorization: Bearer <token> atau ?token=<token>' } }, 401));

  if (!(await rateLimit(env.DB, request, 120, 60))) return wrap(rpcError(null, -32000, 'Terlalu banyak permintaan — tunggu sebentar'));
  await ensureTables(env.DB);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  if (Array.isArray(body)) return wrap(rpcError(null, -32600, 'Batch tidak didukung, kirim satu request'));

  const method = body.method || '';
  const id = body.id !== undefined ? body.id : null;

  if (method === 'initialize') {
    const resp = json({
      jsonrpc: '2.0', id: id,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Server MCP Clincoo AI: full akses ke pengetahuan Clincoo. Tanya dengan clincoo_ask, periksa dengan clincoo_search/clincoo_list, ajari dengan clincoo_add, hapus dengan clincoo_delete.'
      }
    });
    const r = wrap(resp);
    r.headers.set('Mcp-Session-Id', crypto.randomUUID());
    return r;
  }
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return wrap(new Response(null, { status: 202 }));
  }
  if (method === 'ping') return wrap(rpcResult(id, {}));
  if (method === 'tools/list') return wrap(rpcResult(id, { tools: TOOLS }));
  if (method === 'tools/call') {
    const name = body.params && body.params.name;
    const args = (body.params && body.params.arguments) || {};
    const out = await handleToolsCall(env, name, args);
    if (out.error) return wrap(rpcError(id, out.error.code, out.error.message));
    return wrap(rpcResult(id, out));
  }
  return wrap(rpcError(id, -32601, 'Method tidak dikenal: ' + method));
}

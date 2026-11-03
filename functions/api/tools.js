// Proxy tool untuk Clincoo AI: baca web (Jina), cari web (Jina), terminal sandbox (E2B).
// Key disimpan sebagai secret (JINA_API_KEY, E2B_API_KEY), akses dijaga TOOLS_TOKEN.
// Dipakai server-side oleh Clincoo AI; tidak ada key yang pernah sampai ke browser.
const JINA_READ = 'https://r.jina.ai/';
const JINA_SEARCH = 'https://s.jina.ai/';
const E2B_API_BASE = 'https://api.e2b.app';
const E2B_TEMPLATE = 'code-interpreter-v1';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-tools-token',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-tools-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  } });
}

// Batasi panjang input supaya tidak jadi alat penyiksa.
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

async function jina(env, path, url) {
  const key = env.JINA_API_KEY || '';
  const headers = { 'Accept': 'text/plain', 'X-No-Cache': 'true' };
  if (key) headers['Authorization'] = 'Bearer ' + key;
  const r = await fetch(path + url, { headers, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) return { error: 'Jina HTTP ' + r.status + ': ' + text.slice(0, 200) };
  return { text: text.slice(0, 20000) };
}

// --- E2B: buat sandbox, jalankan kode python, hapus ---
async function e2bExec(env, code) {
  const key = env.E2B_API_KEY || '';
  if (!key) return { error: 'E2B_API_KEY belum diset' };
  let sb;
  try {
    const c = await fetch(E2B_API_BASE + '/sandboxes', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateID: E2B_TEMPLATE, timeout: 120, secure: true, allow_internet_access: true }),
      signal: AbortSignal.timeout(30000)
    });
    if (!c.ok) return { error: 'Gagal membuat sandbox (HTTP ' + c.status + '): ' + (await c.text()).slice(0, 200) };
    sb = await c.json();
  } catch (e) { return { error: 'E2B tidak bisa dihubungi: ' + (e && e.message) }; }
  if (!sb || !sb.sandboxID || !sb.envdAccessToken) return { error: 'Respons sandbox tidak valid' };
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Access-Token': sb.envdAccessToken };
    if (sb.trafficAccessToken) headers['E2B-Traffic-Access-Token'] = sb.trafficAccessToken;
    const r = await fetch('https://49999-' + sb.sandboxID + '.' + (sb.domain || 'e2b.app') + '/execute', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: code, context_id: null }),
      signal: AbortSignal.timeout(90000)
    });
    const raw = await r.text();
    if (!r.ok) return { error: 'Eksekusi gagal (HTTP ' + r.status + '): ' + raw.slice(0, 300) };
    let out = '', err = '';
    for (const line of raw.split('\n')) {
      const t = line.trim(); if (!t) continue;
      let o; try { o = JSON.parse(t); } catch (_) { continue; }
      if (o.type === 'stdout') out += o.text || '';
      else if (o.type === 'stderr') err += o.text || '';
      else if (o.type === 'error') err += (o.name || 'Error') + ': ' + (o.value || '') + '\n';
      else if (o.type === 'result' && o.text) out += o.text;
    }
    return { stdout: out.slice(0, 12000), stderr: err.slice(0, 4000) };
  } catch (e) {
    return { error: 'Eksekusi timeout/gagal: ' + (e && e.message) };
  } finally {
    try { await fetch(E2B_API_BASE + '/sandboxes/' + sb.sandboxID, { method: 'DELETE', headers: { 'X-API-Key': key } }); } catch (e) {}
  }
}

// Shell: bungkus perintah shell jadi kode python (tanpa escaping rumit).
function shellToPython(cmd) {
  const b64 = btoa(unescape(encodeURIComponent(cmd))).replace(/\n/g, '');
  return "import base64, subprocess\n"
    + "cmd = base64.b64decode('" + b64 + "').decode()\n"
    + "p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=90)\n"
    + "print(p.stdout[-8000:])\n"
    + "import sys; sys.stderr.write(p.stderr[-3000:])\n";
}

export async function onRequestPost({ request, env }) {
  const token = env.TOOLS_TOKEN || '';
  const given = request.headers.get('x-tools-token') || new URL(request.url).searchParams.get('token') || '';
  if (!token || given !== token) return json({ error: 'Unauthorized' }, 401);

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const action = String(body.action || '').trim();

  // baca satu halaman web jadi teks
  if (action === 'read') {
    const url = clip(body.url, 2000);
    if (!/^https?:\/\//i.test(url)) return json({ error: 'url wajib http(s)' }, 400);
    return json(await jina(env, JINA_READ, url));
  }
  // cari di web
  if (action === 'search') {
    const q = clip(body.query, 300);
    if (!q) return json({ error: 'query wajib' }, 400);
    return json(await jina(env, JINA_SEARCH, encodeURIComponent(q)));
  }
  // terminal sandbox (perintah shell di E2B)
  if (action === 'term') {
    const cmd = clip(body.cmd, 4000);
    if (!cmd) return json({ error: 'cmd wajib' }, 400);
    return json(await e2bExec(env, shellToPython(cmd)));
  }
  // jalankan kode python di sandbox
  if (action === 'python') {
    const code = clip(body.code, 8000);
    if (!code) return json({ error: 'code wajib' }, 400);
    return json(await e2bExec(env, code));
  }
  // screenshot web (butuh chromium di sandbox)
  if (action === 'shot') {
    const url = clip(body.url, 2000);
    if (!/^https?:\/\//i.test(url)) return json({ error: 'url wajib http(s)' }, 400);
    const py = "import base64\n"
      + "from playwright.sync_api import sync_playwright\n"
      + "with sync_playwright() as p:\n"
      + "    b = p.chromium.launch()\n"
      + "    pg = b.new_page(viewport={'width':1280,'height':800})\n"
      + "    pg.goto('" + url.replace(/'/g, "\\'") + "', wait_until='networkidle', timeout=45000)\n"
      + "    png = pg.screenshot(full_page=False)\n"
      + "    print('SHOT:' + base64.b64encode(png).decode())\n"
      + "    b.close()\n";
    const r = await e2bExec(env, py);
    if (r && r.stdout) {
      const m = r.stdout.match(/SHOT:([A-Za-z0-9+/=]+)/);
      if (m) return json({ image: m[1], format: 'png' });
      const noPw = /playwright|ModuleNotFoundError|chromium/i.test(r.stdout + ' ' + (r.stderr || ''));
      return json({ error: noPw ? 'Sandbox belum punya Playwright/Chromium' : 'Screenshot gagal', detail: clip(r.stderr || r.stdout, 400) });
    }
    return json(r);
  }
  return json({ error: 'action tidak dikenal: ' + action }, 400);
}

# Clincoo — melatih model baru

Situs untuk proyek *distillation* Clincoo: Clincoo, model kecil yang pengetahuannya
disusun dari jawaban terkurasi (manusia + model besar).

## Halaman
- `/` — app chat Clincoo langsung (splash screen → chat + sidebar riwayat)
- `/playground/` — pelatihan: tambah data manual, minta jawaban guru AI (OpenRouter → Gemini, otomatis tersimpan), kurasi (setujui/tolak), edit, impor CSV/TXT
- `/chat/` — redirect 301 ke `/` (jalur lama)

## API
- `POST /api/chat` — `{ message }` → `{ reply, trained, match }`
- `PATCH /api/chat` — `{ id, rating }` umpan balik jawaban
- `GET /api/data` — daftar data latihan + statistik
- `POST /api/data` — `{ prompt, answer, source }`
- `PATCH /api/data` — `{ id, rating?, prompt?, answer? }`
- `DELETE /api/data` — `{ id }`
- `POST /api/generate` — `{ prompt, auto_save? }` → jawaban guru AI (OpenRouter → Gemini) yang otomatis disimpan sebagai data latihan
- `GET /api/stats` — statistik publik
- `POST /v1/chat/completions` — kompatibel OpenAI untuk integrasi
- `POST /mcp` — server MCP (Model Context Protocol, Streamable HTTP stateless): full akses pengetahuan Clincoo untuk app AI lain (Claude Desktop dsb.). Tools: clincoo_ask, clincoo_search, clincoo_add, clincoo_list, clincoo_delete. Auth: header `Authorization: Bearer <MCP_TOKEN>` (secret env MCP_TOKEN, wajib diset — tanpa itu endpoint 503).

## Cara kerja Clincoo (MVP)
Clincoo berbasis retrieval atas data latihan terkurasi (BM25-lite + bonus data yang
disetujui manusia). Di bawah ambang kemiripan, Clincoo jujur mengaku belum dilatih,
bukan menebak. Langkah lanjut (fine-tune sungguhan di GPU) bisa ditambah: dataset
terkurasi di sini sudah berformat pasangan instruksi-jawaban.

## Deploy
Cloudflare Pages project `modela` (repo GitHub `muzawwied/Clincoo-AI`, branch `main`).
D1: binding `DB` (database `modela`). Environment secrets (hanya server-side): `OPENROUTER_KEY`, `GEMINI_KEY` (guru AI pelatihan).

Domain: www.clinqoo.biz.id

# Model A — model kecil terlatih dari model besar

Situs untuk proyek *distillation* Clincoo: Model A, model kecil yang pengetahuannya
disusun dari jawaban terkurasi (manusia + model besar).

## Halaman
- `/` — landing: penjelasan pipeline + statistik live
- `/playground/` — pelatihan: tambah data (manual atau minta jawaban model besar), kurasi (setujui/tolak), edit, impor CSV/TXT
- `/chat/` — chat full-screen gaya Clincoo untuk menguji Model A

## API
- `POST /api/chat` — `{ message }` → `{ reply, trained, match }`
- `PATCH /api/chat` — `{ id, rating }` umpan balik jawaban
- `GET /api/data` — daftar data latihan + statistik
- `POST /api/data` — `{ prompt, answer, source }`
- `PATCH /api/data` — `{ id, rating?, prompt?, answer? }`
- `DELETE /api/data` — `{ id }`
- `POST /api/generate` — `{ prompt }` → jawaban model besar (kunci server-side)
- `GET /api/stats` — statistik publik
- `POST /v1/chat/completions` — kompatibel OpenAI untuk integrasi

## Cara kerja Model A (MVP)
Model A berbasis retrieval atas data latihan terkurasi (BM25-lite + bonus data yang
disetujui manusia). Di bawah ambang kemiripan, Model A jujur mengaku belum dilatih,
bukan menebak. Langkah lanjut (fine-tune sungguhan di GPU) bisa ditambah: dataset
terkurasi di sini sudah berformat pasangan instruksi-jawaban.

## Deploy
Cloudflare Pages project `modela` (repo GitHub `muzawwied/Model-A`, branch `main`).
D1: binding `DB` (database `modela`). Environment secret: `MODEL_BIG_KEY` (kunci
model besar, hanya server-side).

Domain: modela.clinqoo.biz.id

# Clincoo AI

Clincoo AI adalah aplikasi chat AI berbasis retrieval yang menggunakan data pengetahuan terkurasi sebagai "ingatan". Sistem mencocokkan pertanyaan pengguna dengan pasangan pertanyaan-jawaban yang tersimpan di Cloudflare D1, lalu dapat menggunakan model AI sebagai guru untuk memperluas pengetahuan ketika belum menemukan kecocokan yang memadai.

## Fitur

- Chat AI melalui halaman utama.
- Retrieval berbasis BM25-lite untuk mencari pengetahuan yang paling mirip.
- Jawaban dari data latihan langsung digunakan jika kecocokannya kuat.
- Jika kecocokan cukup mirip tetapi belum kuat, jawaban dapat ditulis ulang dan divalidasi oleh guru AI.
- Jika pertanyaan belum diketahui, sistem dapat meminta jawaban dari guru AI dan otomatis menyimpannya sebagai pengetahuan baru.
- Pertanyaan identitas dan small talk tertentu ditangani langsung tanpa memanggil model AI.
- Feedback jawaban pengguna (positif/negatif) disimpan di riwayat chat.
- Data pengetahuan dapat ditambah, dicari, diedit, dinilai, dan dihapus melalui API.
- Dataset pengetahuan dapat diunduh sebagai JSON.
- Tersedia endpoint kompatibel OpenAI untuk integrasi aplikasi lain.
- Tersedia server MCP (Model Context Protocol) untuk memberikan akses pengetahuan Clincoo ke aplikasi AI lain.
- Rate limiting berbasis IP diterapkan pada operasi chat dan perubahan data.
- Duplikasi pertanyaan dicegah menggunakan bentuk pertanyaan yang dinormalisasi.

## Struktur Proyek

```text
.
├── assets/
│   └── vendor/
│       ├── marked.min.js
│       └── purify.min.js
├── functions/
│   ├── api/
│   │   ├── chat.js
│   │   ├── data.js
│   │   ├── dataset.js
│   │   ├── generate.js
│   │   └── stats.js
│   ├── v1/
│   │   └── chat/
│   │       └── completions.js
│   ├── helpers.js
│   └── mcp.js
├── public/
│   ├── assets/
│   │   ├── favicon.png
│   │   ├── apple-touch-icon.png
│   │   ├── logo-clincoo.png
│   │   └── vendor/
│   ├── _redirects
│   └── index.html
├── wrangler.toml
└── README.md
```

## Cara Kerja

Alur utama chat berada di `functions/api/chat.js`.

1. Pesan pengguna diterima dan dibatasi panjangnya.
2. Sistem mengambil data pengetahuan dari tabel `examples` di Cloudflare D1.
3. Pertanyaan ditokenisasi dan dibandingkan dengan data latihan menggunakan algoritma BM25-lite.
4. Sistem memakai ambang kecocokan `0.62`.
5. Jika kecocokan sangat kuat (minimal `0.85`), jawaban tersimpan diberikan langsung tanpa proses LLM.
6. Jika kecocokan berada di antara ambang dan `0.85`, guru AI dapat menulis ulang jawaban berdasarkan ingatan yang ditemukan.
7. Jika tidak ada kecocokan yang cukup, guru AI dapat menghasilkan jawaban baru. Jawaban tersebut kemudian disimpan sebagai data latihan dengan sumber `model`.
8. Jika seluruh guru AI tidak tersedia, Clincoo tidak menebak dan memberikan pesan bahwa pertanyaan tersebut belum dilatih.
9. Setiap percakapan dicatat ke tabel `chat_log`.

Data dengan rating `-1` tidak digunakan dalam retrieval chat. Data yang mendapat rating manusia `1` memperoleh bonus skor dalam proses pencocokan.

## Guru AI

Fungsi guru AI berada di `functions/helpers.js` melalui `askGuruAI()`. Sistem menggunakan beberapa lapisan fallback:

1. Cloudflare Workers AI dengan `@cf/openai/gpt-oss-120b`.
2. Guru cadangan melalui layanan Astra untuk pengetahuan baru.
3. Cloudflare Workers AI dengan `@cf/google/gemma-4-26b-a4b-it`.
4. Server Ollama pribadi melalui endpoint Cloudflare Tunnel.
5. OpenRouter dengan beberapa model gratis.
6. Google Gemini sebagai fallback terakhir jika `GEMINI_KEY` tersedia.

Kunci API dipakai di sisi server melalui environment variable dan tidak dikirim ke browser.

Jawaban guru yang digunakan untuk memperluas pengetahuan disimpan melalui `saveTraining()`. Jika pertanyaan yang sama sudah ada, data diperbarui daripada membuat duplikat.

## API

### Chat

`POST /api/chat`

Menerima pesan chat. Format paling sederhana:

```json
{
  "message": "Pertanyaan pengguna"
}
```

Respons menyediakan jawaban, status apakah pengetahuan ditemukan/dilatihkan, model guru jika digunakan, dan informasi kecocokan.

Endpoint ini juga mendukung format `messages` untuk kebutuhan halaman chat.

`PATCH /api/chat`

Menyimpan feedback terhadap jawaban chat:

```json
{
  "id": 123,
  "rating": 1
}
```

Nilai rating yang diterima adalah `1` atau `-1`.

### Data Pengetahuan

`GET /api/data`

Mengambil daftar data latihan. Parameter `q` dapat digunakan untuk mencari berdasarkan pertanyaan atau jawaban.

`POST /api/data`

Menambahkan pasangan pengetahuan:

```json
{
  "prompt": "Pertanyaan",
  "answer": "Jawaban",
  "source": "manusia"
}
```

`PATCH /api/data`

Mengubah rating, pertanyaan, jawaban, atau sumber sebuah data.

`DELETE /api/data`

Menghapus data berdasarkan `id`.

### Generator Guru AI

`POST /api/generate`

Meminta guru AI membuat jawaban untuk sebuah pertanyaan. Secara default hasilnya otomatis disimpan sebagai data latihan.

```json
{
  "prompt": "Pertanyaan baru",
  "auto_save": true
}
```

### Dataset

`GET /api/dataset`

Mengunduh seluruh pengetahuan Clincoo dalam format JSON sebagai file `clincoo-dataset.json`.

### Statistik

`GET /api/stats`

Mengembalikan statistik publik seperti jumlah data pengetahuan, data yang disetujui, data dari model, dan jumlah chat.

### OpenAI-Compatible API

`POST /v1/chat/completions`

Endpoint kompatibel dengan format Chat Completions OpenAI. Aplikasi lain dapat mengirim array `messages` dan menerima respons dengan struktur `chat.completion`.

Endpoint ini menggunakan retrieval Clincoo dan tidak memanggil guru AI ketika tidak menemukan kecocokan.

### MCP

`POST /mcp`

Clincoo menyediakan server MCP berbasis Streamable HTTP yang bersifat stateless.

Tools yang tersedia:

- `clincoo_ask` — bertanya menggunakan pengetahuan Clincoo.
- `clincoo_search` — mencari pengetahuan yang paling mirip.
- `clincoo_add` — menambahkan pengetahuan baru.
- `clincoo_list` — melihat daftar pengetahuan.
- `clincoo_delete` — menghapus pengetahuan berdasarkan ID.

Endpoint MCP memerlukan `MCP_TOKEN`. Token dapat dikirim melalui header:

```text
Authorization: Bearer <MCP_TOKEN>
```

Endpoint juga menyediakan GET untuk koneksi SSE keep-alive pada client MCP yang membutuhkannya.

## Database

Aplikasi menggunakan Cloudflare D1 dengan tiga tabel utama yang dibuat otomatis oleh `ensureTables()`:

### `examples`

Menyimpan pengetahuan Clincoo:

- `id`
- `prompt`
- `prompt_norm`
- `answer`
- `source`
- `rating`
- `created_at`
- `updated_at`

### `chat_log`

Menyimpan riwayat interaksi chat:

- `id`
- `question`
- `reply`
- `matched_id`
- `score`
- `feedback`
- `created_at`

### `write_log`

Digunakan untuk rate limiting berdasarkan alamat IP.

## Frontend

Frontend utama berada di `public/index.html` dan dibuat sebagai halaman chat full-screen.

Frontend menggunakan library yang di-host sendiri untuk Markdown dan sanitasi HTML:

- Marked
- DOMPurify

Beberapa library frontend tambahan dimuat untuk kebutuhan rendering dan pemrosesan konten, termasuk Highlight.js, PDF.js, SheetJS/XLSX, Mammoth, Tailwind CSS, Phosphor Icons, dan Google Fonts.

## Routing

Halaman utama berada di:

```text
/
```

Route lama berikut diarahkan kembali ke halaman utama:

```text
/chat/   -> /
/chat/*  -> /
/playground/   -> /
/playground/* -> /
```

Saat ini tidak ada halaman Playground terpisah yang aktif; route Playground lama diarahkan ke halaman utama melalui `public/_redirects`.

## Deploy

Konfigurasi Cloudflare berada di `wrangler.toml`.

- Cloudflare Pages project: `modela`
- Build output directory: `./public`
- D1 binding: `DB`
- Database: `modela`
- Cloudflare Workers AI binding: `AI`
- Compatibility date: `2026-01-01`

Environment variable/secret yang digunakan oleh backend dapat mencakup:

- `MCP_TOKEN` — wajib untuk mengaktifkan endpoint MCP.
- `OPENROUTER_KEY` — fallback guru AI OpenRouter.
- `GEMINI_KEY` — fallback guru AI Google Gemini.
- `OLLAMA_ENDPOINT` — endpoint Ollama pribadi; jika tidak diatur, kode memiliki endpoint default.

## Domain

Konfigurasi dan kode repository ini saat ini mencantumkan domain aplikasi berikut:

```text
https://www.clinqoo.biz.id
```

Frontend `public/index.html` juga memuat metadata dan referensi deployment pada domain `app.clincoo.buzz`.

## Prinsip Utama

Clincoo tidak dirancang untuk mengarang jawaban ketika retrieval tidak menemukan pengetahuan yang cukup. Sistem memprioritaskan pengetahuan yang sudah tersimpan, menggunakan skor kemiripan untuk menentukan kecocokan, dan dapat memperluas dataset melalui guru AI.

Dengan pendekatan ini, dataset Clincoo dapat terus bertambah dan dapat digunakan tidak hanya oleh halaman chat utama, tetapi juga melalui API OpenAI-compatible dan MCP.

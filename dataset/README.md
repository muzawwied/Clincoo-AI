# Dataset Clincoo AI

Kumpulan data tanya-jawab untuk peningkatan kelanjutan model Qwen3.6 (milik sendiri).
Setiap percakapan yang dijawab model di labs.clincoo.biz.id otomatis tersimpan ke D1
(tabel `examples`, lewat `saveTraining()` di `functions/helpers.js`), lalu diekspor ke sini.

## File

- `qwen3.6-dataset.jsonl` — snapshot dataset, satu contoh per baris, format pesan
  chat standar (llama-factory / axolotl / unsloth kompatibel):
  ```json
  {"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
  ```
- `export.sh` — tarik snapshot terbaru dari produksi lalu regenerasi file JSONL.
  Jalankan: `bash dataset/export.sh`

## Alur pengumpulan

1. User bertanya di labs → model menjawab (Orkestra-1 Mini / Qwen3.6).
2. `functions/api/chat.js` menyimpan pasangan (pertanyaan, jawaban) via
   `saveTraining()` ke D1; duplikat pertanyaan hanya memperbarui jawaban.
3. `GET /api/dataset` mengekspor seluruh isi tabel sebagai JSON.
4. `export.sh` menyaring jawaban error/kuota lalu menuliskannya ke JSONL.

## Pemakaian untuk kelanjutan (fine-tune)

File JSONL ini siap dipakai untuk fine-tune lanjutan (SFT/LoRA) model Qwen di
infrastruktur latihan dengan GPU, bukan di sandbox. Saran praktik:

1. Kurasi manual: hapus contoh yang salah/kurang berkualitas sebelum latihan
   (kualitas dataset > jumlah).
2. Tambahkan pasangan contoh berkualitas tinggi buatan sendiri (jawaban yang
   kamu anggap ideal) — data kecil tapi rapi lebih ampuh daripada data banyak
   yang berisik.
3. Jaga format: satu objek `messages` per baris, jangan multi-baris.

## Catatan privasi

Dataset berisi percakapan nyata pengguna Clincoo. Jangan dibagikan publik
tanpa izin; repo ini bersifat privat.

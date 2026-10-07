#!/usr/bin/env bash
# Ekspor dataset Clincoo dari D1 (via /api/dataset) ke file JSONL siap fine-tune.
# Pemakaian: bash dataset/export.sh   (opsional: DATASET_URL=... bash dataset/export.sh)
set -euo pipefail

URL="${DATASET_URL:-https://labs.clincoo.biz.id/api/dataset}"
OUT="$(cd "$(dirname "$0")" && pwd)/qwen3.6-dataset.jsonl"
TMP="$(mktemp)"

curl -fsSL --max-time 60 "$URL" -o "$TMP"

python3 - "$TMP" "$OUT" <<'PYEOF'
import json, re, sys
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
ERR = re.compile(r'(tidak bisa dihubungi|maaf, terjadi kesalahan|kuota ai)', re.I)
n = 0
with open(out, 'w') as f:
    for it in d.get('items', []):
        p, a = (it.get('prompt') or '').strip(), (it.get('answer') or '').strip()
        if not p or not a or ERR.search(a):
            continue
        f.write(json.dumps({
            "messages": [
                {"role": "user", "content": p},
                {"role": "assistant", "content": a}
            ]
        }, ensure_ascii=False) + "\n")
        n += 1
print(f'OK: {n} contoh ditulis ke {out}')
PYEOF

rm -f "$TMP"

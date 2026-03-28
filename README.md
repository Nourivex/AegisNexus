### Aegis Bridge

Script CLI untuk autentikasi GitHub Copilot (device flow) dan test chat tersedia di:

- `customs/AegisBridge/copilot-cli.mjs`

Contoh pakai:

```bash
node customs/AegisBridge/copilot-cli.mjs login
node customs/AegisBridge/copilot-cli.mjs models
node customs/AegisBridge/copilot-cli.mjs chat
node customs/AegisBridge/copilot-cli.mjs chat --list-models
node customs/AegisBridge/copilot-cli.mjs chat --model gpt-4o --prompt "Halo, tes Copilot"
```

File token akan disimpan di folder script:

- `github-copilot.token.json`

Catatan:

- Login membutuhkan browser untuk memasukkan device code.
- Model yang dipakai dibatasi ke: `gpt-5-mini` atau `gpt-4o`.
- Jika token expired atau invalid, jalankan `login` lagi.
- Script ini hanya untuk pengujian alur autentikasi dan koneksi endpoint.

Dokumentasi progres hari ini:

- `docs/progress-2026-03-28.md`

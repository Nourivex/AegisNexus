# AegisNexus

WebChat orchestration lokal dengan persona The Queen, loop delegasi task, throttling, dan proteksi rate limit.

## Jalankan

```bash
cd customs/AegisNexus
npm install
npm run build
node dist/index.js aegis gateway start
```

Buka: `http://127.0.0.1:18410`

## CLI V2.0

Entry-point CLI sekarang terpusat di file `aegis` / `aegis.ts`.

Build output CLI utama: `dist/index.js` (dengan shebang `#!/usr/bin/env node`).

### Gateway lifecycle

```bash
node dist/index.js aegis gateway start
node dist/index.js aegis gateway stop
node dist/index.js aegis gateway restart
```

### Interactive configure

```bash
node dist/index.js aegis configure
```

## Build + Global Link

```bash
npm run build
npm link
```

Setelah `npm link`, command `aegis` bisa dipanggil global dari terminal:

```bash
aegis gateway start
aegis configure
```

Menu configure mencakup:

- Workspace (set workspace + session key)
- Model (deteksi/ubah model Copilot dengan auth/token flow)
- Skills
- Health check

## Global Workspace

- Workspace default: `~/.aegisnexus` (bisa diubah dari menu Configure -> Workspace).
- Konfigurasi utama: `<WORKSPACE_PATH>/aegisnexus.json`.
- Token Copilot: `<WORKSPACE_PATH>/credentials/github-copilot.token.json`.
- PID daemon gateway: `<WORKSPACE_PATH>/runtime/.aegis.pid`.

Install dependency CLI modern (jika ingin manual):

```bash
npm install commander @inquirer/prompts chalk
npm install -D tsup
```

## Catatan

- Server membaca token + konfigurasi dari global workspace AegisNexus.
- Backend ditulis dalam TypeScript (`server.ts`) dengan strict typing.
- Frontend logic ditulis dalam TypeScript (`frontend/app.ts`) dan di-build ke `public/app.js`.
- Seluruh logic auth-refresh direplikasi langsung di AegisNexus agar project tetap portable sebagai single project.
- Smart intent classification: Queen mendeteksi general vs complex prompt sebelum memutuskan perlu planner/worker atau direct reply.
- Custom Agent Control UI: mode `general`, `full`, atau `custom` dengan toggle planner/worker.
- Execution indicator realtime: mode aktif dan agen aktif (Queen/Planner/Worker) tampil di UI + event log.
- SQLite memory (`aegisnexus.db`) menyimpan sessions/messages dengan pagination history (DESC LIMIT, lalu dibalik ASC).
- Persona system prompt dibaca dinamis dari `personas/the_queen.md` dan selalu di-inject di index 0 saat request Copilot.
- Auto-throttle 3-6 detik antar request Copilot.
- Jika kena HTTP 429, otomatis pause 30 detik lalu retry.
- Maksimal 3 iterasi auto-loop, lalu minta approval untuk lanjut.
- Auto-refresh token berjalan ketika sisa masa berlaku <= 30 menit, plus cron check tiap 5 menit.

Detail implementasi ada di `docs/memory-persona-integration.md`.

Ringkasan progres lintas AegisBridge + AegisNexus ada di `docs/progress-2026-03-28.md`.

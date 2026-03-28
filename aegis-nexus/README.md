# AegisNexus

WebChat orchestration lokal dengan persona The Queen, loop delegasi task, throttling, dan proteksi rate limit.

## Jalankan

```bash
cd customs/AegisBridge/aegis-nexus
npm install
npm start
```

Buka: `http://127.0.0.1:3030`

## Catatan

- Menggunakan token dari `../github-copilot.token.json`.
- Backend ditulis dalam TypeScript (`server.ts`) dengan strict typing.
- Frontend logic ditulis dalam TypeScript (`frontend/app.ts`) dan di-build ke `public/app.js`.
- Seluruh logic auth-refresh direplikasi langsung di AegisNexus agar project tetap portable sebagai single project.
- Smart intent classification: Queen mendeteksi general vs complex prompt sebelum memutuskan perlu planner/worker atau direct reply.
- Custom Agent Control UI: mode `general`, `full`, atau `custom` dengan toggle planner/worker.
- Execution indicator realtime: mode aktif dan agen aktif (Queen/Planner/Worker) tampil di UI + event log.
- Auto-throttle 3-6 detik antar request Copilot.
- Jika kena HTTP 429, otomatis pause 30 detik lalu retry.
- Maksimal 3 iterasi auto-loop, lalu minta approval untuk lanjut.
- Auto-refresh token berjalan ketika sisa masa berlaku <= 30 menit, plus cron check tiap 5 menit.

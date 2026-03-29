# Memory + Persona Integration

Dokumen ini menjelaskan implementasi SQLite memory dan Markdown persona engine di AegisNexus.

## Struktur

```text
AegisNexus/
  database.ts
  server.ts
  personas/
    the_queen.md
  docs/
    memory-persona-integration.md
```

## database.ts

`database.ts` menginisialisasi `aegisnexus.db` dengan dua tabel:

- `sessions(id, created_at, updated_at)`
- `messages(id, session_id, role, content, timestamp)`

Pagination history diwajibkan menggunakan query DESC + LIMIT, lalu dibalik ke ASC untuk konteks:

```sql
SELECT id, session_id, role, content, timestamp
FROM messages
WHERE session_id = ?
ORDER BY timestamp DESC
LIMIT ?
```

Lalu di kode:

```ts
const rows = historyStmt.all(sessionId, cappedLimit) as ChatMessageRow[];
return rows.slice().reverse().map((row) => ({
  role: row.role,
  content: row.content,
  timestamp: row.timestamp,
}));
```

## Persona Markdown Engine

Persona dibaca dari file `personas/the_queen.md` setiap request Copilot:

```ts
async function readPersonaMarkdown(): Promise<string> {
  const text = await fs.readFile(PERSONA_MD_PATH, "utf8");
  return text.trim();
}
```

Lalu selalu di-inject sebagai system message index pertama:

```ts
const requestMessages = [
  { role: "system", content: personaMarkdown },
  ...history.map((item) => ({ role: item.role, content: item.content })),
  ...params.messages.filter((msg) => msg.role !== "system"),
];
```

## Integrasi di server.ts

Saat request user masuk:

1. Simpan user message ke SQLite.
2. Jalankan routing/orchestration.
3. Simpan assistant answer ke SQLite.

```ts
memoryDb.ensureSession(sessionId);
memoryDb.addMessage(sessionId, "user", userMessage);

const result = await runOrchestration({ sessionId, userMessage, continueApproved, control });

memoryDb.addMessage(sessionId, "assistant", result.answer);
```

Dengan pola ini, memori tetap ringan (pagination), urutan konteks benar (ASC), dan persona selalu dinamis dari markdown.

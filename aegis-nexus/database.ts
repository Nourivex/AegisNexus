import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessageRow = {
  id: number;
  session_id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  timestamp: number;
};

export type AegisDatabase = {
  dbPath: string;
  ensureSession: (sessionId: string) => void;
  addMessage: (sessionId: string, role: ChatRole, content: string) => void;
  getChatHistory: (sessionId: string, limit?: number) => ChatMessage[];
};

export function initDatabase(params: { baseDir: string; dbFileName?: string }): AegisDatabase {
  const dbFileName = params.dbFileName?.trim() || "aegisnexus.db";
  const dbPath = path.join(params.baseDir, dbFileName);

  if (!fs.existsSync(params.baseDir)) {
    fs.mkdirSync(params.baseDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_time
    ON messages(session_id, timestamp DESC);
  `);

  const upsertSessionStmt = db.prepare(`
    INSERT INTO sessions (id, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `);

  const insertMessageStmt = db.prepare(
    "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
  );

  const historyStmt = db.prepare(
    "SELECT id, session_id, role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?",
  );

  function ensureSession(sessionId: string): void {
    const now = Date.now();
    upsertSessionStmt.run(sessionId, now, now);
  }

  function addMessage(sessionId: string, role: ChatRole, content: string): void {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }
    ensureSession(sessionId);
    insertMessageStmt.run(sessionId, role, trimmed, Date.now());
    upsertSessionStmt.run(sessionId, Date.now(), Date.now());
  }

  function getChatHistory(sessionId: string, limit = 20): ChatMessage[] {
    const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 20;

    // Pagination-friendly query: newest first + limit.
    const rows = historyStmt.all(sessionId, cappedLimit) as ChatMessageRow[];

    // Reorder back to ASC for correct conversational context.
    return rows
      .slice()
      .reverse()
      .map((row) => ({ role: row.role, content: row.content, timestamp: row.timestamp }));
  }

  return {
    dbPath,
    ensureSession,
    addMessage,
    getChatHistory,
  };
}

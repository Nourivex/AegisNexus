#!/usr/bin/env node

// server.ts
import fs3 from "fs/promises";
import http from "http";
import path3 from "path";
import process2 from "process";
import { fileURLToPath as fileURLToPath2 } from "url";

// database.ts
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
function initDatabase(params) {
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
    "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)"
  );
  const historyStmt = db.prepare(
    "SELECT id, session_id, role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?"
  );
  function ensureSession(sessionId) {
    const now = Date.now();
    upsertSessionStmt.run(sessionId, now, now);
  }
  function addMessage(sessionId, role, content) {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }
    ensureSession(sessionId);
    insertMessageStmt.run(sessionId, role, trimmed, Date.now());
    upsertSessionStmt.run(sessionId, Date.now(), Date.now());
  }
  function getChatHistory(sessionId, limit = 20) {
    const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 20;
    const rows = historyStmt.all(sessionId, cappedLimit);
    return rows.slice().reverse().map((row) => ({ role: row.role, content: row.content, timestamp: row.timestamp }));
  }
  return {
    dbPath,
    ensureSession,
    addMessage,
    getChatHistory
  };
}

// workspace.ts
import fs2 from "fs";
import fsp from "fs/promises";
import os from "os";
import path2 from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var CURRENT_DIR = path2.dirname(__filename);
var PROJECT_ROOT = path2.basename(CURRENT_DIR) === "dist" ? path2.dirname(CURRENT_DIR) : CURRENT_DIR;
var WORKSPACE_POINTER_FILE = path2.join(PROJECT_ROOT, ".aegisnexus.path");
var DEFAULT_MODEL = "gpt-5-mini";
var DEFAULT_GATEWAY_PORT = 18410;
function getDefaultWorkspaceRoot() {
  if (process.platform === "win32") {
    return "L:\\.aegisnexus";
  }
  return path2.join(os.homedir(), ".aegisnexus");
}
function getConfiguredWorkspaceRoot() {
  if (fs2.existsSync(WORKSPACE_POINTER_FILE)) {
    const raw = fs2.readFileSync(WORKSPACE_POINTER_FILE, "utf8").trim();
    if (raw) {
      return path2.resolve(raw);
    }
  }
  if (process.env.AEGISNEXUS_WORKSPACE?.trim()) {
    return path2.resolve(process.env.AEGISNEXUS_WORKSPACE.trim());
  }
  return getDefaultWorkspaceRoot();
}
function resolveWorkspacePaths(workspaceRoot = getConfiguredWorkspaceRoot()) {
  return {
    projectRoot: PROJECT_ROOT,
    workspaceRoot,
    credentialsDir: path2.join(workspaceRoot, "credentials"),
    memoryDir: path2.join(workspaceRoot, "memory"),
    skillsDir: path2.join(workspaceRoot, "skills"),
    logsDir: path2.join(workspaceRoot, "logs"),
    runtimeDir: path2.join(workspaceRoot, "runtime"),
    configFile: path2.join(workspaceRoot, "aegisnexus.json"),
    tokenFile: path2.join(workspaceRoot, "credentials", "github-copilot.token.json"),
    pidFile: path2.join(workspaceRoot, "runtime", ".aegis.pid"),
    gatewayLogFile: path2.join(workspaceRoot, "logs", "gateway.log")
  };
}
async function readWorkspaceConfig(paths) {
  const raw = await fsp.readFile(paths.configFile, "utf8");
  const parsed = JSON.parse(raw);
  return {
    workspacePath: String(parsed.workspacePath || paths.workspaceRoot),
    sessionKey: String(parsed.sessionKey || "main"),
    gatewayPort: Number(parsed.gatewayPort || DEFAULT_GATEWAY_PORT),
    selectedModel: String(parsed.selectedModel || DEFAULT_MODEL),
    skills: {
      planner: Boolean(parsed.skills?.planner ?? true),
      worker: Boolean(parsed.skills?.worker ?? true),
      queenGuard: Boolean(parsed.skills?.queenGuard ?? true)
    }
  };
}
async function writeWorkspaceConfig(paths, config) {
  const payload = `${JSON.stringify(config, null, 2)}
`;
  await fsp.writeFile(paths.configFile, payload, "utf8");
}
async function setWorkspacePointer(workspaceRoot) {
  await fsp.writeFile(WORKSPACE_POINTER_FILE, `${path2.resolve(workspaceRoot)}
`, "utf8");
}
async function ensureWorkspace(workspaceRoot = getConfiguredWorkspaceRoot()) {
  let paths = resolveWorkspacePaths(workspaceRoot);
  const createDirectories = async (target) => {
    await Promise.all([
      fsp.mkdir(target.workspaceRoot, { recursive: true }),
      fsp.mkdir(target.credentialsDir, { recursive: true }),
      fsp.mkdir(target.memoryDir, { recursive: true }),
      fsp.mkdir(target.skillsDir, { recursive: true }),
      fsp.mkdir(target.logsDir, { recursive: true }),
      fsp.mkdir(target.runtimeDir, { recursive: true })
    ]);
  };
  try {
    await createDirectories(paths);
  } catch {
    const requestedDefault = path2.resolve(workspaceRoot) === path2.resolve(getDefaultWorkspaceRoot());
    if (!(process.platform === "win32" && requestedDefault)) {
      throw new Error(`Gagal membuat workspace di ${workspaceRoot}`);
    }
    const fallbackRoot = path2.join(os.homedir(), ".aegisnexus");
    paths = resolveWorkspacePaths(fallbackRoot);
    await createDirectories(paths);
  }
  await setWorkspacePointer(paths.workspaceRoot);
  if (!fs2.existsSync(paths.configFile)) {
    await writeWorkspaceConfig(paths, {
      workspacePath: paths.workspaceRoot,
      sessionKey: "main",
      gatewayPort: DEFAULT_GATEWAY_PORT,
      selectedModel: DEFAULT_MODEL,
      skills: {
        planner: true,
        worker: true,
        queenGuard: true
      }
    });
  }
  const config = await readWorkspaceConfig(paths);
  return { paths, config };
}

// server.ts
var __filename2 = fileURLToPath2(import.meta.url);
var CURRENT_DIR2 = path3.dirname(__filename2);
var PROJECT_ROOT2 = path3.basename(CURRENT_DIR2) === "dist" ? path3.dirname(CURRENT_DIR2) : CURRENT_DIR2;
var PUBLIC_DIR = path3.join(PROJECT_ROOT2, "public");
var PERSONA_PATH = path3.join(PROJECT_ROOT2, "persona.config.json");
var PERSONA_MD_PATH = path3.join(PROJECT_ROOT2, "personas", "the_queen.md");
var WORKSPACE_PATHS = resolveWorkspacePaths();
var TOKEN_PATH = WORKSPACE_PATHS.tokenFile;
var COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
var PORT = Number(process2.env.AEGIS_NEXUS_PORT || 18410);
var REFRESH_THRESHOLD_MS = 30 * 60 * 1e3;
var REFRESH_POLL_MS = 5 * 60 * 1e3;
var eventClients = /* @__PURE__ */ new Set();
var sessionState = /* @__PURE__ */ new Map();
var memoryDb = initDatabase({ baseDir: WORKSPACE_PATHS.memoryDir, dbFileName: "aegisnexus.db" });
async function loadWorkspaceRuntimeConfig() {
  const ensured = await ensureWorkspace(WORKSPACE_PATHS.workspaceRoot);
  const cfg = await readWorkspaceConfig(ensured.paths);
  return {
    selectedModel: String(cfg.selectedModel || "").trim(),
    sessionKey: String(cfg.sessionKey || "main").trim() || "main"
  };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function emitLog(payload) {
  const line = `data: ${JSON.stringify({ ...payload, at: nowIso() })}

`;
  for (const res of eventClients) {
    res.write(line);
  }
}
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data)
  });
  res.end(data);
}
async function readJsonFile(filePath, label) {
  try {
    const raw = await fs3.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Gagal membaca ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function loadPersonaConfig() {
  const cfg = await readJsonFile(PERSONA_PATH, "persona config");
  const throttle = cfg.throttleMs ?? {};
  const preferredRaw = Array.isArray(cfg.preferredModels) ? cfg.preferredModels : ["gpt-5-mini", "gpt-4o"];
  return {
    name: String(cfg.name || "The Queen"),
    systemPrompt: String(cfg.systemPrompt || "You are The Queen orchestration manager."),
    maxAutoIterations: Number(cfg.maxAutoIterations || 3),
    throttleMs: {
      min: Number(throttle.min || 3e3),
      max: Number(throttle.max || 6e3)
    },
    retryOn429Ms: Number(cfg.retryOn429Ms || 3e4),
    preferredModels: preferredRaw.map((v) => String(v)),
    defaultModel: String(cfg.defaultModel || "gpt-5-mini")
  };
}
async function readTokenStore() {
  const tokenJson = await readJsonFile(TOKEN_PATH, "token file github-copilot.token.json");
  const githubAccessToken = String(tokenJson.githubAccessToken || "").trim();
  const token = String(tokenJson.copilotSessionToken || "").trim();
  const baseUrl = String(tokenJson.baseUrl || "https://api.githubcopilot.com").trim().replace(/\/$/, "");
  const expiresAt = Number(tokenJson.expiresAt || 0);
  if (!githubAccessToken) {
    throw new Error("githubAccessToken kosong di token file. Jalankan login ulang dari CLI.");
  }
  if (!token) {
    throw new Error("copilotSessionToken kosong di token file.");
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error("expiresAt token tidak valid di token file.");
  }
  return {
    githubAccessToken,
    copilotSessionToken: token,
    baseUrl,
    expiresAt,
    updatedAt: Number(tokenJson.updatedAt || Date.now())
  };
}
async function writeTokenStore(store) {
  await fs3.writeFile(
    TOKEN_PATH,
    `${JSON.stringify(
      {
        provider: "github-copilot",
        githubAccessToken: store.githubAccessToken,
        copilotSessionToken: store.copilotSessionToken,
        baseUrl: store.baseUrl,
        expiresAt: store.expiresAt,
        updatedAt: Date.now()
      },
      null,
      2
    )}
`,
    "utf8"
  );
}
function parseExpiresAtMs(expiresAtRaw) {
  if (typeof expiresAtRaw === "number" && Number.isFinite(expiresAtRaw)) {
    return expiresAtRaw > 1e10 ? expiresAtRaw : expiresAtRaw * 1e3;
  }
  if (typeof expiresAtRaw === "string" && expiresAtRaw.trim()) {
    const parsed = Number.parseInt(expiresAtRaw, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("expires_at tidak valid dari endpoint Copilot");
    }
    return parsed > 1e10 ? parsed : parsed * 1e3;
  }
  throw new Error("expires_at tidak tersedia dari endpoint Copilot");
}
function deriveBaseUrlFromToken(token) {
  const match = token.match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEp = match?.[1]?.trim();
  if (!proxyEp) {
    return "https://api.githubcopilot.com";
  }
  const host = proxyEp.replace(/^https?:\/\//i, "").replace(/^proxy\./i, "api.");
  return host ? `https://${host}` : "https://api.githubcopilot.com";
}
async function refreshCopilotSessionLocal(githubAccessToken) {
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubAccessToken}`,
      "User-Agent": "GitHubCopilotChat/0.26.7"
    }
  });
  const raw = await res.text();
  const json = raw.trim() ? JSON.parse(raw) : {};
  if (!res.ok) {
    const detail = json.error?.message || json.message || `HTTP ${res.status}`;
    throw new Error(`Refresh Copilot session gagal: ${detail}`);
  }
  const token = String(json.token || "").trim();
  if (!token) {
    throw new Error("Refresh Copilot session gagal: token kosong.");
  }
  return {
    token,
    baseUrl: deriveBaseUrlFromToken(token),
    expiresAt: parseExpiresAtMs(json.expires_at),
    source: "aegis-nexus-local-refresh"
  };
}
async function ensureFreshCopilotAuth(params) {
  const tokenStore = await readTokenStore();
  const remainingMs = tokenStore.expiresAt - Date.now();
  if (remainingMs > REFRESH_THRESHOLD_MS) {
    return {
      token: tokenStore.copilotSessionToken,
      baseUrl: tokenStore.baseUrl
    };
  }
  emitLog({
    level: "info",
    scope: "auth-refresh",
    message: `Token mendekati expiry, refresh dipicu (${params.reason})`,
    meta: { remainingMs }
  });
  const refreshed = await refreshCopilotSessionLocal(tokenStore.githubAccessToken);
  const nextStore = {
    githubAccessToken: tokenStore.githubAccessToken,
    copilotSessionToken: refreshed.token,
    baseUrl: refreshed.baseUrl,
    expiresAt: refreshed.expiresAt,
    updatedAt: Date.now()
  };
  await writeTokenStore(nextStore);
  emitLog({
    level: "info",
    scope: "auth-refresh",
    message: `Refresh token sukses dari ${refreshed.source}`,
    meta: { expiresAt: refreshed.expiresAt }
  });
  return {
    token: nextStore.copilotSessionToken,
    baseUrl: nextStore.baseUrl
  };
}
async function readBodyJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const bodyText = Buffer.concat(chunks).toString("utf8").trim();
  if (!bodyText) {
    return {};
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error("Request body bukan JSON valid.");
  }
}
function readTextContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((part) => {
    if (typeof part === "string") {
      return part;
    }
    if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
      return String(part.text);
    }
    return "";
  }).join("");
}
async function callCopilotChat(params) {
  const endpoint = `${params.baseUrl}/chat/completions`;
  const personaMarkdown = await readPersonaMarkdown();
  const history = memoryDb.getChatHistory(params.sessionId, 20);
  const requestMessages = [
    { role: "system", content: personaMarkdown },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    ...params.messages.filter((msg) => msg.role !== "system")
  ];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "OpenAI-Intent": "conversation-panel",
        "Copilot-Integration-Id": "vscode-chat",
        "Editor-Version": "vscode/1.99.0",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "X-Request-Id": `aegis-nexus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      },
      body: JSON.stringify({ model: params.model, stream: false, messages: requestMessages, temperature: 0.2 })
    });
    const raw = await res.text();
    let json = {};
    try {
      json = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      json = { message: raw.slice(0, 400) };
    }
    if (res.status === 429 && attempt === 1) {
      emitLog({ level: "warn", scope: "safety", message: "HTTP 429 terdeteksi, pause 30 detik lalu retry", meta: params.meta });
      await sleep(params.retryOn429Ms);
      continue;
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Akses ditolak endpoint Copilot (HTTP ${res.status}). Token invalid atau expired.`);
      }
      const detail = json.error?.message || json.message || `HTTP ${res.status}`;
      throw new Error(`Copilot request gagal: ${detail}`);
    }
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const firstChoice = choices[0] || {};
    const message = firstChoice.message || {};
    const content = readTextContent(message.content);
    const usedModel = String(json.model || params.model);
    if (!content.trim()) {
      throw new Error("Response Copilot tidak memiliki konten teks.");
    }
    return { content, model: usedModel };
  }
  throw new Error("Copilot request gagal setelah retry.");
}
function safeJsonFromText(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
async function readPersonaMarkdown() {
  try {
    const text = await fs3.readFile(PERSONA_MD_PATH, "utf8");
    const trimmed = text.trim();
    return trimmed || "You are The Queen orchestration manager.";
  } catch {
    return "You are The Queen orchestration manager.";
  }
}
function parseAgentControl(value) {
  const asObj = value && typeof value === "object" ? value : {};
  const rawMode = String(asObj.mode || "full").trim().toLowerCase();
  const mode = rawMode === "general" || rawMode === "custom" ? rawMode : "full";
  return {
    mode,
    enablePlanner: Boolean(asObj.enablePlanner ?? true),
    enableWorker: Boolean(asObj.enableWorker ?? true)
  };
}
function isLikelyComplexPrompt(input) {
  const text = input.toLowerCase();
  const markers = [
    "buat",
    "implement",
    "arsitektur",
    "multi",
    "langkah",
    "workflow",
    "debug",
    "refactor",
    "riset",
    "integrasi",
    "backend",
    "frontend",
    "database",
    "api",
    "docker"
  ];
  return markers.some((marker) => text.includes(marker));
}
async function classifyIntentWithQueen(params) {
  if (isLikelyComplexPrompt(params.userMessage)) {
    return "complex";
  }
  emitLog({ level: "info", scope: "queen", message: "Intent classification start", meta: { agent: "queen" } });
  const classify = await callCopilotChat({
    sessionId: params.sessionId,
    token: params.auth.token,
    baseUrl: params.auth.baseUrl,
    model: params.selectedModel,
    retryOn429Ms: params.persona.retryOn429Ms,
    meta: { stage: "intent-classification" },
    messages: [
      {
        role: "system",
        content: [
          params.persona.systemPrompt,
          "Classify input intent.",
          'Return STRICT JSON: {"intent":"general"|"complex","reason":"..."}',
          "general = casual question/chitchat/simple answer.",
          "complex = multi-step build/research/debug/integration tasks."
        ].join("\n")
      },
      { role: "user", content: params.userMessage }
    ]
  });
  const decision = safeJsonFromText(classify.content, { intent: "general" });
  const intent = String(decision.intent || "general").toLowerCase();
  emitLog({ level: "info", scope: "queen", message: `Intent: ${intent}`, meta: { agent: "queen" } });
  return intent === "complex" ? "complex" : "general";
}
async function replyDirectByQueen(params) {
  emitLog({ level: "info", scope: "queen", message: "Queen direct reply", meta: { agent: "queen", mode: params.mode } });
  const queen = await callCopilotChat({
    sessionId: params.sessionId,
    token: params.auth.token,
    baseUrl: params.auth.baseUrl,
    model: params.selectedModel,
    retryOn429Ms: params.persona.retryOn429Ms,
    meta: { stage: "queen-direct" },
    messages: [
      {
        role: "system",
        content: `${params.persona.systemPrompt}
Answer directly and clearly without delegating to other agents.`
      },
      { role: "user", content: params.userMessage }
    ]
  });
  return {
    answer: queen.content,
    model: queen.model,
    iteration: 1,
    needsApproval: false,
    execution: {
      mode: params.mode,
      path: "queen-direct",
      activeAgents: ["queen"]
    }
  };
}
async function runOrchestration(params) {
  const persona = await loadPersonaConfig();
  const workspaceCfg = await loadWorkspaceRuntimeConfig();
  const auth = await ensureFreshCopilotAuth({ reason: "request-start" });
  const preferred = persona.preferredModels.length ? persona.preferredModels : [persona.defaultModel];
  const selectedModel = workspaceCfg.selectedModel || (preferred.includes(persona.defaultModel) ? persona.defaultModel : preferred[0]);
  if (params.control.mode === "general") {
    return await replyDirectByQueen({
      sessionId: params.sessionId,
      persona,
      auth,
      selectedModel,
      userMessage: params.userMessage,
      mode: params.control.mode
    });
  }
  const intent = await classifyIntentWithQueen({
    sessionId: params.sessionId,
    persona,
    auth,
    selectedModel,
    userMessage: params.userMessage
  });
  if (intent === "general") {
    return await replyDirectByQueen({
      sessionId: params.sessionId,
      persona,
      auth,
      selectedModel,
      userMessage: params.userMessage,
      mode: params.control.mode
    });
  }
  const plannerEnabled = params.control.mode === "full" ? true : params.control.enablePlanner;
  const workerEnabled = params.control.mode === "full" ? true : params.control.enableWorker;
  if (!plannerEnabled && !workerEnabled) {
    return await replyDirectByQueen({
      sessionId: params.sessionId,
      persona,
      auth,
      selectedModel,
      userMessage: params.userMessage,
      mode: params.control.mode
    });
  }
  const previous = sessionState.get(params.sessionId);
  let seedTask = params.userMessage.trim();
  let iterationStart = 1;
  if (params.continueApproved && previous?.paused) {
    seedTask = previous.nextTask || seedTask;
    iterationStart = previous.iteration + 1;
    emitLog({ level: "info", scope: "orchestrator", message: "Melanjutkan loop setelah approval user", meta: { sessionId: params.sessionId } });
  }
  let finalAnswer = "";
  let usedModel = selectedModel;
  const activeAgents = ["queen", plannerEnabled ? "planner" : "", workerEnabled ? "worker" : ""].filter(
    Boolean
  );
  for (let iteration = iterationStart; iteration <= persona.maxAutoIterations; iteration += 1) {
    emitLog({ level: "info", scope: "orchestrator", message: `Iterasi ${iteration} dimulai`, meta: { sessionId: params.sessionId } });
    let planned = {
      subtasks: [seedTask],
      mergeInstruction: "Gabungkan hasil subtask menjadi jawaban final yang jelas."
    };
    if (plannerEnabled) {
      emitLog({ level: "info", scope: "planner", message: "Planner aktif", meta: { agent: "planner", iteration } });
      const plannerDelay = randomInt(persona.throttleMs.min, persona.throttleMs.max);
      await sleep(plannerDelay);
      const planner = await callCopilotChat({
        sessionId: params.sessionId,
        token: auth.token,
        baseUrl: auth.baseUrl,
        model: selectedModel,
        retryOn429Ms: persona.retryOn429Ms,
        meta: { stage: "planner", iteration },
        messages: [
          {
            role: "system",
            content: [
              `${persona.systemPrompt}`,
              "Return STRICT JSON with shape:",
              '{"subtasks":["..."],"mergeInstruction":"..."}',
              "Max subtasks: 3"
            ].join("\n")
          },
          { role: "user", content: seedTask }
        ]
      });
      usedModel = planner.model;
      planned = safeJsonFromText(planner.content, planned);
    } else {
      emitLog({ level: "info", scope: "planner", message: "Planner dimatikan (custom override)", meta: { agent: "planner", iteration } });
    }
    const subtasksRaw = Array.isArray(planned.subtasks) ? planned.subtasks : [seedTask];
    const subtasks = subtasksRaw.map((v) => String(v).trim()).filter(Boolean).slice(0, 3);
    emitLog({ level: "info", scope: "planner", message: `Subtask: ${subtasks.length}`, meta: { iteration } });
    const taskOutputs = [];
    for (let idx = 0; idx < subtasks.length; idx += 1) {
      if (workerEnabled) {
        const throttle = randomInt(persona.throttleMs.min, persona.throttleMs.max);
        await sleep(throttle);
        emitLog({ level: "info", scope: "worker", message: `Worker subtask #${idx + 1} start`, meta: { agent: "worker", iteration } });
        const worker = await callCopilotChat({
          sessionId: params.sessionId,
          token: auth.token,
          baseUrl: auth.baseUrl,
          model: selectedModel,
          retryOn429Ms: persona.retryOn429Ms,
          meta: { stage: "worker", iteration, subtask: idx + 1 },
          messages: [
            {
              role: "system",
              content: `${persona.systemPrompt}
You are executing one subtask. Keep response concise and actionable.`
            },
            { role: "user", content: `Subtask #${idx + 1}: ${subtasks[idx]}` }
          ]
        });
        usedModel = worker.model;
        taskOutputs.push({ subtask: subtasks[idx], output: worker.content });
        emitLog({ level: "info", scope: "worker", message: `Subtask #${idx + 1} selesai`, meta: { agent: "worker", iteration } });
      } else {
        taskOutputs.push({ subtask: subtasks[idx], output: `Worker disabled by custom override. Pending: ${subtasks[idx]}` });
        emitLog({ level: "info", scope: "worker", message: `Worker dimatikan (subtask #${idx + 1})`, meta: { agent: "worker", iteration } });
      }
    }
    const mergeDelay = randomInt(persona.throttleMs.min, persona.throttleMs.max);
    await sleep(mergeDelay);
    const mergeInstruction = String(planned.mergeInstruction || "Gabungkan hasil subtask menjadi jawaban final.");
    const merger = await callCopilotChat({
      sessionId: params.sessionId,
      token: auth.token,
      baseUrl: auth.baseUrl,
      model: selectedModel,
      retryOn429Ms: persona.retryOn429Ms,
      meta: { stage: "merger", iteration },
      messages: [
        {
          role: "system",
          content: `${persona.systemPrompt}
Merge all task outputs into one cohesive response for the user.`
        },
        {
          role: "user",
          content: `${mergeInstruction}

${JSON.stringify(taskOutputs, null, 2)}`
        }
      ]
    });
    finalAnswer = merger.content;
    usedModel = merger.model;
    const judgeDelay = randomInt(persona.throttleMs.min, persona.throttleMs.max);
    await sleep(judgeDelay);
    const judge = await callCopilotChat({
      sessionId: params.sessionId,
      token: auth.token,
      baseUrl: auth.baseUrl,
      model: selectedModel,
      retryOn429Ms: persona.retryOn429Ms,
      meta: { stage: "judge", iteration },
      messages: [
        {
          role: "system",
          content: [
            `${persona.systemPrompt}`,
            "Decide if final answer is complete.",
            'Return STRICT JSON: {"complete":boolean,"nextTask":"...","reason":"..."}'
          ].join("\n")
        },
        {
          role: "user",
          content: `Original request: ${params.userMessage}

Current answer:
${finalAnswer}`
        }
      ]
    });
    const decision = safeJsonFromText(judge.content, {
      complete: iteration >= 2,
      nextTask: "Perbaiki jawaban agar lebih lengkap dan terstruktur.",
      reason: "fallback"
    });
    if (Boolean(decision.complete)) {
      sessionState.delete(params.sessionId);
      emitLog({ level: "info", scope: "orchestrator", message: `Selesai di iterasi ${iteration}`, meta: { sessionId: params.sessionId } });
      return {
        answer: finalAnswer,
        model: usedModel,
        iteration,
        needsApproval: false,
        execution: {
          mode: params.control.mode,
          path: "orchestration",
          activeAgents
        }
      };
    }
    if (iteration >= persona.maxAutoIterations) {
      sessionState.set(params.sessionId, {
        paused: true,
        iteration,
        nextTask: String(decision.nextTask || "Lanjutkan perbaikan jawaban."),
        lastAnswer: finalAnswer
      });
      emitLog({ level: "warn", scope: "safety", message: "Mencapai max iteration, menunggu approval user", meta: { sessionId: params.sessionId } });
      return {
        answer: `${finalAnswer}

[PAUSED] Max iteration tercapai. Klik lanjutkan jika ingin iterasi tambahan.`,
        model: usedModel,
        iteration,
        needsApproval: true,
        execution: {
          mode: params.control.mode,
          path: "orchestration",
          activeAgents
        }
      };
    }
    seedTask = String(decision.nextTask || "Perbaiki jawaban agar lebih tajam dan lengkap.");
  }
  return {
    answer: finalAnswer || "Tidak ada jawaban.",
    model: usedModel,
    iteration: persona.maxAutoIterations,
    needsApproval: true,
    execution: {
      mode: params.control.mode,
      path: "orchestration",
      activeAgents
    }
  };
}
function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}
async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolved = path3.normalize(path3.join(PUBLIC_DIR, pathname));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    const data = await fs3.readFile(resolved);
    res.writeHead(200, { "Content-Type": contentType(resolved) });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}
var server = http.createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, time: nowIso() });
      return;
    }
    if (method === "GET" && url.pathname === "/api/config") {
      const persona = await loadPersonaConfig();
      const workspaceCfg = await loadWorkspaceRuntimeConfig();
      sendJson(res, 200, {
        persona: { name: persona.name, maxAutoIterations: persona.maxAutoIterations },
        preferredModels: persona.preferredModels,
        selectedModel: workspaceCfg.selectedModel,
        sessionKey: workspaceCfg.sessionKey,
        defaultAgentControl: {
          mode: "full",
          enablePlanner: true,
          enableWorker: true
        }
      });
      return;
    }
    if (method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      res.write(`data: ${JSON.stringify({ level: "info", scope: "system", message: "Log stream connected", at: nowIso() })}

`);
      eventClients.add(res);
      req.on("close", () => {
        eventClients.delete(res);
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/chat") {
      const body = await readBodyJson(req);
      const userMessage = String(body.message || "").trim();
      const sessionId = String(body.sessionId || "default").trim() || "default";
      const continueApproved = Boolean(body.continueApproved);
      const control = parseAgentControl(body.agentControl);
      if (!userMessage) {
        sendJson(res, 400, { error: "message wajib diisi" });
        return;
      }
      memoryDb.ensureSession(sessionId);
      memoryDb.addMessage(sessionId, "user", userMessage);
      emitLog({ level: "info", scope: "user", message: userMessage, meta: { sessionId, mode: control.mode } });
      const result = await runOrchestration({ sessionId, userMessage, continueApproved, control });
      memoryDb.addMessage(sessionId, "assistant", result.answer);
      sendJson(res, 200, result);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitLog({ level: "error", scope: "system", message });
    sendJson(res, 500, { error: message });
  }
});
void ensureWorkspace(WORKSPACE_PATHS.workspaceRoot).then(() => {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`AegisNexus running at http://127.0.0.1:${PORT}`);
    console.log(`Workspace: ${WORKSPACE_PATHS.workspaceRoot}`);
    console.log(`Token source: ${TOKEN_PATH}`);
  });
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to initialize workspace: ${message}`);
  process2.exit(1);
});
setInterval(() => {
  void ensureFreshCopilotAuth({ reason: "cron" }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    emitLog({ level: "error", scope: "auth-refresh", message });
  });
}, REFRESH_POLL_MS);

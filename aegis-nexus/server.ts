#!/usr/bin/env node

import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

type PersonaConfig = {
  name: string;
  systemPrompt: string;
  maxAutoIterations: number;
  throttleMs: {
    min: number;
    max: number;
  };
  retryOn429Ms: number;
  preferredModels: string[];
  defaultModel: string;
};

type SessionState = {
  paused: boolean;
  iteration: number;
  nextTask: string;
  lastAnswer: string;
};

type ChatResult = {
  answer: string;
  model: string;
  iteration: number;
  needsApproval: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const PERSONA_PATH = path.join(__dirname, "persona.config.json");
const TOKEN_PATH = path.join(__dirname, "..", "github-copilot.token.json");
const PORT = Number(process.env.AEGIS_NEXUS_PORT || 3030);

const eventClients = new Set<ServerResponse>();
const sessionState = new Map<string, SessionState>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emitLog(payload: JsonRecord): void {
  const line = `data: ${JSON.stringify({ ...payload, at: nowIso() })}\n\n`;
  for (const res of eventClients) {
    res.write(line);
  }
}

function sendJson(res: ServerResponse, status: number, body: JsonRecord): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function readJsonFile(filePath: string, label: string): Promise<JsonRecord> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as JsonRecord;
  } catch (error) {
    throw new Error(`Gagal membaca ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadPersonaConfig(): Promise<PersonaConfig> {
  const cfg = await readJsonFile(PERSONA_PATH, "persona config");
  const throttle = (cfg.throttleMs ?? {}) as JsonRecord;
  const preferredRaw = Array.isArray(cfg.preferredModels) ? cfg.preferredModels : ["gpt-5-mini", "gpt-4o"];
  return {
    name: String(cfg.name || "The Queen"),
    systemPrompt: String(cfg.systemPrompt || "You are The Queen orchestration manager."),
    maxAutoIterations: Number(cfg.maxAutoIterations || 3),
    throttleMs: {
      min: Number(throttle.min || 3000),
      max: Number(throttle.max || 6000),
    },
    retryOn429Ms: Number(cfg.retryOn429Ms || 30000),
    preferredModels: preferredRaw.map((v) => String(v)),
    defaultModel: String(cfg.defaultModel || "gpt-5-mini"),
  };
}

async function loadTokenFile(): Promise<{ token: string; baseUrl: string }> {
  const tokenJson = await readJsonFile(TOKEN_PATH, "token file github-copilot.token.json");
  const token = String(tokenJson.copilotSessionToken || "").trim();
  const baseUrl = String(tokenJson.baseUrl || "https://api.githubcopilot.com").trim().replace(/\/$/, "");
  const expiresAt = Number(tokenJson.expiresAt || 0);

  if (!token) {
    throw new Error("copilotSessionToken kosong di token file.");
  }

  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    throw new Error("Token Copilot expired. Jalankan login ulang dari CLI auth.");
  }

  return { token, baseUrl };
}

async function readBodyJson(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const bodyText = Buffer.concat(chunks).toString("utf8").trim();
  if (!bodyText) {
    return {};
  }
  try {
    return JSON.parse(bodyText) as JsonRecord;
  } catch {
    throw new Error("Request body bukan JSON valid.");
  }
}

function readTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as JsonRecord).type === "text" &&
        "text" in part &&
        typeof (part as JsonRecord).text === "string"
      ) {
        return String((part as JsonRecord).text);
      }
      return "";
    })
    .join("");
}

async function callCopilotChat(params: {
  token: string;
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  retryOn429Ms: number;
  meta: JsonRecord;
}): Promise<{ content: string; model: string }> {
  const endpoint = `${params.baseUrl}/chat/completions`;
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
        "X-Request-Id": `aegis-nexus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      body: JSON.stringify({ model: params.model, stream: false, messages: params.messages, temperature: 0.2 }),
    });

    const raw = await res.text();
    let json: JsonRecord = {};
    try {
      json = raw.trim() ? (JSON.parse(raw) as JsonRecord) : {};
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
      const detail =
        ((json.error as JsonRecord | undefined)?.message as string | undefined) ||
        (json.message as string | undefined) ||
        `HTTP ${res.status}`;
      throw new Error(`Copilot request gagal: ${detail}`);
    }

    const choices = Array.isArray(json.choices) ? json.choices : [];
    const firstChoice = (choices[0] || {}) as JsonRecord;
    const message = (firstChoice.message || {}) as JsonRecord;
    const content = readTextContent(message.content);
    const usedModel = String(json.model || params.model);
    if (!content.trim()) {
      throw new Error("Response Copilot tidak memiliki konten teks.");
    }
    return { content, model: usedModel };
  }

  throw new Error("Copilot request gagal setelah retry.");
}

function safeJsonFromText(text: string, fallback: JsonRecord): JsonRecord {
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    return fallback;
  }
}

async function runOrchestration(params: {
  sessionId: string;
  userMessage: string;
  continueApproved: boolean;
}): Promise<ChatResult> {
  const persona = await loadPersonaConfig();
  const auth = await loadTokenFile();
  const preferred = persona.preferredModels.length ? persona.preferredModels : [persona.defaultModel];
  const selectedModel = preferred.includes(persona.defaultModel) ? persona.defaultModel : preferred[0];

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

  for (let iteration = iterationStart; iteration <= persona.maxAutoIterations; iteration += 1) {
    emitLog({ level: "info", scope: "orchestrator", message: `Iterasi ${iteration} dimulai`, meta: { sessionId: params.sessionId } });

    const plannerDelay = randomInt(persona.throttleMs.min, persona.throttleMs.max);
    await sleep(plannerDelay);

    const planner = await callCopilotChat({
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
            "Max subtasks: 3",
          ].join("\n"),
        },
        { role: "user", content: seedTask },
      ],
    });

    usedModel = planner.model;
    const planned = safeJsonFromText(planner.content, {
      subtasks: [seedTask],
      mergeInstruction: "Gabungkan hasil subtask menjadi jawaban final yang jelas.",
    });

    const subtasksRaw = Array.isArray(planned.subtasks) ? planned.subtasks : [seedTask];
    const subtasks = subtasksRaw.map((v) => String(v).trim()).filter(Boolean).slice(0, 3);
    emitLog({ level: "info", scope: "planner", message: `Subtask: ${subtasks.length}`, meta: { iteration } });

    const taskOutputs: Array<{ subtask: string; output: string }> = [];
    for (let idx = 0; idx < subtasks.length; idx += 1) {
      const throttle = randomInt(persona.throttleMs.min, persona.throttleMs.max);
      await sleep(throttle);

      const worker = await callCopilotChat({
        token: auth.token,
        baseUrl: auth.baseUrl,
        model: selectedModel,
        retryOn429Ms: persona.retryOn429Ms,
        meta: { stage: "worker", iteration, subtask: idx + 1 },
        messages: [
          {
            role: "system",
            content: `${persona.systemPrompt}\nYou are executing one subtask. Keep response concise and actionable.`,
          },
          { role: "user", content: `Subtask #${idx + 1}: ${subtasks[idx]}` },
        ],
      });

      usedModel = worker.model;
      taskOutputs.push({ subtask: subtasks[idx], output: worker.content });
      emitLog({ level: "info", scope: "worker", message: `Subtask #${idx + 1} selesai`, meta: { iteration } });
    }

    const mergeDelay = randomInt(persona.throttleMs.min, persona.throttleMs.max);
    await sleep(mergeDelay);

    const mergeInstruction = String(planned.mergeInstruction || "Gabungkan hasil subtask menjadi jawaban final.");
    const merger = await callCopilotChat({
      token: auth.token,
      baseUrl: auth.baseUrl,
      model: selectedModel,
      retryOn429Ms: persona.retryOn429Ms,
      meta: { stage: "merger", iteration },
      messages: [
        {
          role: "system",
          content: `${persona.systemPrompt}\nMerge all task outputs into one cohesive response for the user.`,
        },
        {
          role: "user",
          content: `${mergeInstruction}\n\n${JSON.stringify(taskOutputs, null, 2)}`,
        },
      ],
    });

    finalAnswer = merger.content;
    usedModel = merger.model;

    const judgeDelay = randomInt(persona.throttleMs.min, persona.throttleMs.max);
    await sleep(judgeDelay);

    const judge = await callCopilotChat({
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
            "Return STRICT JSON: {\"complete\":boolean,\"nextTask\":\"...\",\"reason\":\"...\"}",
          ].join("\n"),
        },
        {
          role: "user",
          content: `Original request: ${params.userMessage}\n\nCurrent answer:\n${finalAnswer}`,
        },
      ],
    });

    const decision = safeJsonFromText(judge.content, {
      complete: iteration >= 2,
      nextTask: "Perbaiki jawaban agar lebih lengkap dan terstruktur.",
      reason: "fallback",
    });

    if (Boolean(decision.complete)) {
      sessionState.delete(params.sessionId);
      emitLog({ level: "info", scope: "orchestrator", message: `Selesai di iterasi ${iteration}`, meta: { sessionId: params.sessionId } });
      return {
        answer: finalAnswer,
        model: usedModel,
        iteration,
        needsApproval: false,
      };
    }

    if (iteration >= persona.maxAutoIterations) {
      sessionState.set(params.sessionId, {
        paused: true,
        iteration,
        nextTask: String(decision.nextTask || "Lanjutkan perbaikan jawaban."),
        lastAnswer: finalAnswer,
      });
      emitLog({ level: "warn", scope: "safety", message: "Mencapai max iteration, menunggu approval user", meta: { sessionId: params.sessionId } });
      return {
        answer: `${finalAnswer}\n\n[PAUSED] Max iteration tercapai. Klik lanjutkan jika ingin iterasi tambahan.`,
        model: usedModel,
        iteration,
        needsApproval: true,
      };
    }

    seedTask = String(decision.nextTask || "Perbaiki jawaban agar lebih tajam dan lengkap.");
  }

  return {
    answer: finalAnswer || "Tidak ada jawaban.",
    model: usedModel,
    iteration: persona.maxAutoIterations,
    needsApproval: true,
  };
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const data = await fs.readFile(resolved);
    res.writeHead(200, { "Content-Type": contentType(resolved) });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, time: nowIso() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/config") {
      const persona = await loadPersonaConfig();
      sendJson(res, 200, {
        persona: { name: persona.name, maxAutoIterations: persona.maxAutoIterations },
        preferredModels: persona.preferredModels,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ level: "info", scope: "system", message: "Log stream connected", at: nowIso() })}\n\n`);
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

      if (!userMessage) {
        sendJson(res, 400, { error: "message wajib diisi" });
        return;
      }

      emitLog({ level: "info", scope: "user", message: userMessage, meta: { sessionId } });
      const result = await runOrchestration({ sessionId, userMessage, continueApproved });
      sendJson(res, 200, result as unknown as JsonRecord);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitLog({ level: "error", scope: "system", message });
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AegisNexus running at http://127.0.0.1:${PORT}`);
  console.log(`Token source: ${TOKEN_PATH}`);
});

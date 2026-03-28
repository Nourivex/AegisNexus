#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const DEFAULT_COPILOT_API_BASE_URL = "https://api.githubcopilot.com";
const TOKEN_FILE_NAME = "github-copilot.token.json";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PREFERRED_MODELS = ["gpt-5-mini", "gpt-4o"];

function usage() {
  console.log(
    [
      "GitHub Copilot CLI Auth/Test",
      "",
      "Usage:",
      "  node copilot-cli.mjs login",
      "  node copilot-cli.mjs models",
      "  node copilot-cli.mjs chat [--model <id>] [--prompt \"...\"] [--list-models]",
      "",
      "Commands:",
      "  login    Device flow login GitHub, exchange ke Copilot session token, lalu simpan token file",
      "  models   Menampilkan model yang tersedia dari endpoint Copilot",
      "  chat     Baca token file dan kirim prompt test ke endpoint chat Copilot",
    ].join("\n"),
  );
}

function resolveTokenFilePath() {
  return path.join(SCRIPT_DIR, TOKEN_FILE_NAME);
}

async function writeTokenFileSecure(filePath, payload) {
  const data = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(filePath, data, { mode: 0o600 });

  // Ensure restrictive permissions when possible.
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Ignore permission errors on platforms/filesystems that do not support chmod semantics.
  }
}

function safeJsonParse(text, contextLabel) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respon ${contextLabel} bukan JSON yang valid.`);
  }
}

async function parseJsonResponse(res, contextLabel) {
  const bodyText = await res.text();
  if (!bodyText.trim()) {
    return {};
  }
  return safeJsonParse(bodyText, contextLabel);
}

function parseArgs(argv) {
  const args = { model: "", prompt: "", listModels: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--model") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Argumen --model membutuhkan nilai model id.");
      }
      args.model = value;
      i += 1;
      continue;
    }

    if (token === "--prompt") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Argumen --prompt membutuhkan teks prompt.");
      }
      args.prompt = value;
      i += 1;
      continue;
    }

    if (token === "--list-models") {
      args.listModels = true;
      continue;
    }

    throw new Error(`Argumen tidak dikenal: ${token}`);
  }
  return args;
}

async function requestDeviceCode() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "read:user",
  });

  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Gagal meminta device code (HTTP ${res.status}).`);
  }

  const json = await parseJsonResponse(res, "device code GitHub");
  if (!json.device_code || !json.user_code || !json.verification_uri || !json.expires_in) {
    throw new Error("Respon device code GitHub tidak lengkap.");
  }

  return {
    deviceCode: String(json.device_code),
    userCode: String(json.user_code),
    verificationUri: String(json.verification_uri),
    expiresInSec: Number(json.expires_in),
    intervalSec: Number(json.interval || 5),
  };
}

async function pollAccessToken({ deviceCode, expiresInSec, intervalSec }) {
  const expiresAt = Date.now() + expiresInSec * 1000;
  let delayMs = Math.max(1000, intervalSec * 1000);

  while (Date.now() < expiresAt) {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    const res = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`Gagal polling access token GitHub (HTTP ${res.status}).`);
    }

    const json = await parseJsonResponse(res, "access token GitHub");
    if (typeof json.access_token === "string" && json.access_token.length > 0) {
      return json.access_token;
    }

    const errorCode = String(json.error || "unknown");
    if (errorCode === "authorization_pending") {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (errorCode === "slow_down") {
      delayMs += 2000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (errorCode === "expired_token") {
      throw new Error("Otorisasi gagal: device code sudah expired.");
    }
    if (errorCode === "access_denied") {
      throw new Error("Otorisasi dibatalkan user di browser.");
    }

    throw new Error(`Otorisasi gagal: ${errorCode}`);
  }

  throw new Error("Otorisasi gagal: timeout menunggu persetujuan device flow.");
}

function parseExpiresAtMs(expiresAtRaw) {
  if (typeof expiresAtRaw === "number" && Number.isFinite(expiresAtRaw)) {
    return expiresAtRaw > 10_000_000_000 ? expiresAtRaw : expiresAtRaw * 1000;
  }

  if (typeof expiresAtRaw === "string" && expiresAtRaw.trim()) {
    const parsed = Number.parseInt(expiresAtRaw, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("Respon Copilot token memiliki expires_at tidak valid.");
    }
    return parsed > 10_000_000_000 ? parsed : parsed * 1000;
  }

  throw new Error("Respon Copilot token tidak memiliki expires_at.");
}

function deriveCopilotBaseUrlFromSessionToken(sessionToken) {
  const match = String(sessionToken).match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEp = match?.[1]?.trim();
  if (!proxyEp) {
    return DEFAULT_COPILOT_API_BASE_URL;
  }

  const host = proxyEp.replace(/^https?:\/\//i, "").replace(/^proxy\./i, "api.");
  if (!host) {
    return DEFAULT_COPILOT_API_BASE_URL;
  }

  return `https://${host}`;
}

async function fetchCopilotSessionToken(githubAccessToken) {
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubAccessToken}`,
      "User-Agent": "GitHubCopilotChat/0.26.7",
    },
  });

  const json = await parseJsonResponse(res, "Copilot session token");

  if (!res.ok) {
    const message = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(`Gagal exchange ke Copilot session token: ${message}`);
  }

  if (!json.token || !json.expires_at) {
    throw new Error("Respon Copilot session token tidak lengkap (token/expires_at tidak ada).");
  }

  const token = String(json.token);
  const expiresAt = parseExpiresAtMs(json.expires_at);
  const baseUrl = deriveCopilotBaseUrlFromSessionToken(token);

  return { token, expiresAt, baseUrl };
}

async function loginCommand() {
  if (!process.stdin.isTTY) {
    throw new Error("Perintah login membutuhkan terminal interaktif (TTY).");
  }

  console.log("[1/3] Meminta device code ke GitHub...");
  const device = await requestDeviceCode();

  console.log("\nSilakan otorisasi di browser:");
  console.log(`- URL  : ${device.verificationUri}`);
  console.log(`- CODE : ${device.userCode}`);

  console.log("\n[2/3] Menunggu approval dari browser...");
  const githubAccessToken = await pollAccessToken(device);

  console.log("[3/3] Exchange ke Copilot session token...");
  const copilot = await fetchCopilotSessionToken(githubAccessToken);

  const payload = {
    provider: "github-copilot",
    githubAccessToken,
    copilotSessionToken: copilot.token,
    baseUrl: copilot.baseUrl,
    expiresAt: copilot.expiresAt,
    updatedAt: Date.now(),
  };

  const tokenPath = resolveTokenFilePath();
  await writeTokenFileSecure(tokenPath, payload);

  console.log(`\nSukses. Token disimpan ke: ${tokenPath}`);
  console.log(`Token berlaku sampai: ${new Date(copilot.expiresAt).toISOString()}`);
}

async function readStoredTokenFile() {
  const filePath = resolveTokenFilePath();

  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `File token tidak ditemukan: ${filePath}. Jalankan \"login\" terlebih dahulu.`,
      );
    }
    throw error;
  }

  const json = safeJsonParse(raw, "file token lokal");
  const token = String(json.copilotSessionToken || "").trim();
  const expiresAt = Number(json.expiresAt || 0);
  const baseUrl = String(json.baseUrl || DEFAULT_COPILOT_API_BASE_URL).trim();

  if (!token) {
    throw new Error("File token tidak berisi copilotSessionToken.");
  }

  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error("File token tidak berisi expiresAt yang valid.");
  }

  if (Date.now() >= expiresAt) {
    throw new Error("Token Copilot sudah expired. Jalankan login ulang.");
  }

  return { token, baseUrl, expiresAt };
}

function resolveTextFromMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && part.type === "text") {
          return typeof part.text === "string" ? part.text : "";
        }
        return "";
      })
      .join("");
  }

  return "";
}

async function askPromptInteractively(initialPrompt) {
  if (initialPrompt && initialPrompt.trim()) {
    return initialPrompt.trim();
  }

  if (!process.stdin.isTTY) {
    throw new Error("Mode chat tanpa --prompt membutuhkan terminal interaktif.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const value = await rl.question("Masukkan pertanyaan: ");
    const prompt = value.trim();
    if (!prompt) {
      throw new Error("Prompt tidak boleh kosong.");
    }
    return prompt;
  } finally {
    rl.close();
  }
}

async function fetchAvailableModels({ token, baseUrl }) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/models`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "Copilot-Integration-Id": "vscode-chat",
    },
  });

  const json = await parseJsonResponse(res, "models Copilot");

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Endpoint model menolak token (HTTP ${res.status}). Jalankan login ulang atau cek entitlement Copilot.`,
      );
    }
    const detail = json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(`Gagal mengambil daftar model: ${detail}`);
  }

  const entries = Array.isArray(json?.data) ? json.data : [];
  const ids = entries
    .map((entry) => (entry && typeof entry === "object" ? String(entry.id || "").trim() : ""))
    .filter((id) => id.length > 0);

  const available = new Set(ids);
  return PREFERRED_MODELS.filter((modelId) => available.has(modelId));
}

async function chooseModelInteractively(initialModel, models) {
  if (initialModel && initialModel.trim()) {
    const chosen = initialModel.trim();
    if (!PREFERRED_MODELS.includes(chosen)) {
      throw new Error(
        `Model \"${chosen}\" tidak diizinkan. Gunakan salah satu: ${PREFERRED_MODELS.join(", ")}.`,
      );
    }
    return chosen;
  }

  if (!models.length) {
    throw new Error(
      `Model yang diizinkan tidak tersedia untuk akun ini. Butuh salah satu: ${PREFERRED_MODELS.join(
        ", ",
      )}.`,
    );
  }

  if (!process.stdin.isTTY) {
    return models[0];
  }

  console.log("\nModel tersedia:");
  for (let i = 0; i < models.length; i += 1) {
    console.log(`${i + 1}. ${models[i]}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question("Pilih nomor model (Enter = 1): ");
    const trimmed = answer.trim();
    if (!trimmed) {
      return models[0];
    }

    const picked = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(picked) || picked < 1 || picked > models.length) {
      throw new Error("Pilihan model tidak valid.");
    }

    return models[picked - 1];
  } finally {
    rl.close();
  }
}

async function sendChatCompletion({ token, baseUrl, model, prompt }) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "OpenAI-Intent": "conversation-panel",
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": "vscode/1.99.0",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "X-Request-Id": `copilot-cli-${Date.now()}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });

  const json = await parseJsonResponse(res, "chat completions Copilot");

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Endpoint menolak token (HTTP ${res.status}). Token invalid/expired atau akun tidak punya akses model.`,
      );
    }

    if (res.status >= 500) {
      throw new Error(
        `Endpoint Copilot bermasalah (HTTP ${res.status}). Coba lagi beberapa saat lagi.`,
      );
    }

    const detail = json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(`Permintaan chat gagal: ${detail}`);
  }

  const resolvedModel =
    String(json.model || "").trim() ||
    String(json?.choices?.[0]?.model || "").trim() ||
    model;

  const content = resolveTextFromMessageContent(json?.choices?.[0]?.message?.content);

  if (!content.trim()) {
    throw new Error("Respon chat diterima tapi tidak mengandung teks balasan.");
  }

  return {
    model: resolvedModel,
    content,
  };
}

async function chatCommand(argv) {
  const args = parseArgs(argv);
  const stored = await readStoredTokenFile();
  const models = await fetchAvailableModels({ token: stored.token, baseUrl: stored.baseUrl });

  if (args.listModels) {
    if (!models.length) {
      console.log("Tidak ada model yang terdeteksi dari endpoint Copilot.");
      return;
    }
    console.log("Model tersedia:");
    for (const modelId of models) {
      console.log(`- ${modelId}`);
    }
    return;
  }

  const selectedModel = await chooseModelInteractively(args.model, models);
  const prompt = await askPromptInteractively(args.prompt);

  console.log("Mengirim prompt ke Copilot...");

  let response;
  try {
    response = await sendChatCompletion({
      token: stored.token,
      baseUrl: stored.baseUrl,
      model: selectedModel,
      prompt,
    });
  } catch (error) {
    if (String(error?.message || "").includes("fetch failed")) {
      throw new Error(
        "Koneksi ke endpoint Copilot gagal (network/DNS/TLS). Cek internet atau firewall.",
      );
    }
    throw error;
  }

  console.log(`\nModel terdeteksi: ${response.model}`);
  console.log("\nBalasan:");
  console.log(response.content);
}

async function main() {
  const [rawCommand, ...rest] = process.argv.slice(2);
  const command = rawCommand === "--models" ? "models" : rawCommand;

  if (!command || command === "-h" || command === "--help") {
    usage();
    process.exit(0);
  }

  if (command === "login") {
    await loginCommand();
    return;
  }

  if (command === "chat") {
    await chatCommand(rest);
    return;
  }

  if (command === "models") {
    const stored = await readStoredTokenFile();
    const models = await fetchAvailableModels({ token: stored.token, baseUrl: stored.baseUrl });
    if (!models.length) {
      console.log("Tidak ada model yang terdeteksi dari endpoint Copilot.");
      return;
    }
    console.log("Model tersedia:");
    for (const modelId of models) {
      console.log(`- ${modelId}`);
    }
    return;
  }

  throw new Error(`Perintah tidak dikenal: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});

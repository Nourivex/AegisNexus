#!/usr/bin/env node
// index.ts
import process3 from "process";
import chalk2 from "chalk";

// aegis.ts
import fs2 from "fs";
import fsp2 from "fs/promises";
import process2 from "process";
import path2 from "path";
import { spawn, spawnSync } from "child_process";
import { Command } from "commander";
import chalk from "chalk";
import { checkbox, confirm, input, select } from "@inquirer/prompts";

// workspace.ts
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var CURRENT_DIR = path.dirname(__filename);
var PROJECT_ROOT = path.basename(CURRENT_DIR) === "dist" ? path.dirname(CURRENT_DIR) : CURRENT_DIR;
var WORKSPACE_POINTER_FILE = path.join(PROJECT_ROOT, ".aegisnexus.path");
var DEFAULT_MODEL = "gpt-5-mini";
var DEFAULT_GATEWAY_PORT = 18410;
function getDefaultWorkspaceRoot() {
  return path.join(os.homedir(), ".aegisnexus");
}
function getConfiguredWorkspaceRoot() {
  if (fs.existsSync(WORKSPACE_POINTER_FILE)) {
    const raw = fs.readFileSync(WORKSPACE_POINTER_FILE, "utf8").trim();
    if (raw) {
      return path.resolve(raw);
    }
  }
  if (process.env.AEGISNEXUS_WORKSPACE?.trim()) {
    return path.resolve(process.env.AEGISNEXUS_WORKSPACE.trim());
  }
  return getDefaultWorkspaceRoot();
}
function resolveWorkspacePaths(workspaceRoot = getConfiguredWorkspaceRoot()) {
  return {
    projectRoot: PROJECT_ROOT,
    workspaceRoot,
    credentialsDir: path.join(workspaceRoot, "credentials"),
    memoryDir: path.join(workspaceRoot, "memory"),
    skillsDir: path.join(workspaceRoot, "skills"),
    logsDir: path.join(workspaceRoot, "logs"),
    runtimeDir: path.join(workspaceRoot, "runtime"),
    configFile: path.join(workspaceRoot, "aegisnexus.json"),
    tokenFile: path.join(workspaceRoot, "credentials", "github-copilot.token.json"),
    pidFile: path.join(workspaceRoot, "runtime", ".aegis.pid"),
    gatewayLogFile: path.join(workspaceRoot, "logs", "gateway.log")
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
  await fsp.writeFile(WORKSPACE_POINTER_FILE, `${path.resolve(workspaceRoot)}
`, "utf8");
}
async function ensureWorkspace(workspaceRoot = getConfiguredWorkspaceRoot()) {
  const paths = resolveWorkspacePaths(workspaceRoot);
  await Promise.all([
    fsp.mkdir(paths.workspaceRoot, { recursive: true }),
    fsp.mkdir(paths.credentialsDir, { recursive: true }),
    fsp.mkdir(paths.memoryDir, { recursive: true }),
    fsp.mkdir(paths.skillsDir, { recursive: true }),
    fsp.mkdir(paths.logsDir, { recursive: true }),
    fsp.mkdir(paths.runtimeDir, { recursive: true })
  ]);
  await setWorkspacePointer(paths.workspaceRoot);
  if (!fs.existsSync(paths.configFile)) {
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

// aegis.ts
var CLIENT_ID = "Iv1.b507a08c87ecfe98";
var DEVICE_CODE_URL = "https://github.com/login/device/code";
var ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
var COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
var DEFAULT_COPILOT_API_BASE_URL = "https://api.githubcopilot.com";
var ALLOWED_MODELS = ["gpt-5-mini", "gpt-4o", "claude-3.7-sonnet", "claude-3.5-sonnet"];
function header(title) {
  console.log(chalk.cyan.bold(`
AegisNexus V2.0 | ${title}`));
}
function success(text) {
  console.log(chalk.green(text));
}
function warn(text) {
  console.log(chalk.yellow(text));
}
function parseExpiresAtMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e10 ? value : value * 1e3;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed > 1e10 ? parsed : parsed * 1e3;
    }
  }
  throw new Error("expires_at tidak valid.");
}
function deriveBaseUrlFromSessionToken(sessionToken) {
  const match = String(sessionToken).match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEp = match?.[1]?.trim();
  if (!proxyEp) {
    return DEFAULT_COPILOT_API_BASE_URL;
  }
  const host = proxyEp.replace(/^https?:\/\//i, "").replace(/^proxy\./i, "api.");
  return host ? `https://${host}` : DEFAULT_COPILOT_API_BASE_URL;
}
async function parseJsonResponse(res, label) {
  const raw = await res.text();
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Response ${label} bukan JSON valid.`);
  }
}
async function requestDeviceCode() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "read:user"
  });
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!res.ok) {
    throw new Error(`Gagal meminta device code (HTTP ${res.status}).`);
  }
  const json = await parseJsonResponse(res, "device code GitHub");
  if (!json.device_code || !json.user_code || !json.verification_uri || !json.expires_in) {
    throw new Error("Response device flow tidak lengkap.");
  }
  return {
    deviceCode: String(json.device_code),
    userCode: String(json.user_code),
    verificationUri: String(json.verification_uri),
    expiresInSec: Number(json.expires_in),
    intervalSec: Number(json.interval || 5)
  };
}
async function pollAccessToken(params) {
  const expiresAt = Date.now() + params.expiresInSec * 1e3;
  let delayMs = Math.max(1e3, params.intervalSec * 1e3);
  while (Date.now() < expiresAt) {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      device_code: params.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    });
    const res = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    if (!res.ok) {
      throw new Error(`Gagal polling access token (HTTP ${res.status}).`);
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
      delayMs += 2e3;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (errorCode === "access_denied") {
      throw new Error("Device flow dibatalkan user.");
    }
    throw new Error(`Device flow gagal: ${errorCode}`);
  }
  throw new Error("Device flow timeout.");
}
async function exchangeCopilotSession(githubAccessToken) {
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubAccessToken}`,
      "User-Agent": "GitHubCopilotChat/0.26.7"
    }
  });
  const json = await parseJsonResponse(res, "copilot token");
  if (!res.ok) {
    const detail = String(json.message || json.error || `HTTP ${res.status}`);
    throw new Error(`Exchange Copilot gagal: ${detail}`);
  }
  const token = String(json.token || "").trim();
  if (!token) {
    throw new Error("Copilot session token kosong.");
  }
  return {
    token,
    baseUrl: deriveBaseUrlFromSessionToken(token),
    expiresAt: parseExpiresAtMs(json.expires_at)
  };
}
async function loadToken(paths) {
  const raw = await fsp2.readFile(paths.tokenFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.githubAccessToken || !parsed.copilotSessionToken || !parsed.expiresAt) {
    throw new Error("Token file tidak lengkap.");
  }
  return {
    provider: String(parsed.provider || "github-copilot"),
    githubAccessToken: String(parsed.githubAccessToken),
    copilotSessionToken: String(parsed.copilotSessionToken),
    baseUrl: String(parsed.baseUrl || DEFAULT_COPILOT_API_BASE_URL),
    expiresAt: Number(parsed.expiresAt),
    updatedAt: Number(parsed.updatedAt || Date.now())
  };
}
async function saveToken(paths, token) {
  await fsp2.mkdir(path2.dirname(paths.tokenFile), { recursive: true });
  await fsp2.writeFile(paths.tokenFile, `${JSON.stringify(token, null, 2)}
`, "utf8");
}
async function ensureToken(paths) {
  try {
    const token = await loadToken(paths);
    if (Date.now() >= token.expiresAt - 6e4) {
      const refreshed = await exchangeCopilotSession(token.githubAccessToken);
      const next = {
        provider: "github-copilot",
        githubAccessToken: token.githubAccessToken,
        copilotSessionToken: refreshed.token,
        baseUrl: refreshed.baseUrl,
        expiresAt: refreshed.expiresAt,
        updatedAt: Date.now()
      };
      await saveToken(paths, next);
      return next;
    }
    return token;
  } catch {
    warn("Token belum valid. Memulai login device flow...");
    const device = await requestDeviceCode();
    console.log(chalk.yellow(`Buka URL: ${device.verificationUri}`));
    console.log(chalk.yellow(`Masukkan code: ${device.userCode}`));
    const githubAccessToken = await pollAccessToken(device);
    const session = await exchangeCopilotSession(githubAccessToken);
    const created = {
      provider: "github-copilot",
      githubAccessToken,
      copilotSessionToken: session.token,
      baseUrl: session.baseUrl,
      expiresAt: session.expiresAt,
      updatedAt: Date.now()
    };
    await saveToken(paths, created);
    success("Token berhasil dibuat dan disimpan di workspace global.");
    return created;
  }
}
async function fetchModels(token) {
  const endpoint = `${token.baseUrl.replace(/\/$/, "")}/models`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token.copilotSessionToken}`,
      Accept: "application/json",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "Copilot-Integration-Id": "vscode-chat"
    }
  });
  const json = await parseJsonResponse(res, "models");
  if (!res.ok) {
    const detail = String(json.message || json.error || `HTTP ${res.status}`);
    throw new Error(`Gagal mengambil model: ${detail}`);
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map((row) => row && typeof row === "object" ? String(row.id || "").trim() : "").filter(Boolean);
}
async function configureWorkspace() {
  header("Configure Workspace");
  const current = await ensureWorkspace();
  const workspacePath = await input({
    message: "Workspace path",
    default: current.paths.workspaceRoot
  });
  const sessionKey = await input({
    message: "Session key",
    default: current.config.sessionKey
  });
  const gatewayPortRaw = await input({
    message: "Gateway port",
    default: String(current.config.gatewayPort || 18410)
  });
  const parsedPort = Number.parseInt(gatewayPortRaw.trim(), 10);
  const gatewayPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 18410;
  const resolved = path2.resolve(workspacePath.trim() || current.paths.workspaceRoot);
  const next = await ensureWorkspace(resolved);
  await writeWorkspaceConfig(next.paths, {
    ...next.config,
    workspacePath: resolved,
    sessionKey: sessionKey.trim() || "main",
    gatewayPort
  });
  await setWorkspacePointer(resolved);
  success(`Workspace diset ke ${resolved}`);
}
async function configureModel() {
  header("Configure Model");
  const ws = await ensureWorkspace();
  const token = await ensureToken(ws.paths);
  const remoteModels = await fetchModels(token);
  const available = remoteModels.filter((id) => ALLOWED_MODELS.includes(id));
  const selected = await select({
    message: "Pilih model utama",
    choices: ALLOWED_MODELS.map((model) => ({
      name: available.includes(model) ? model : `${model} (not detected)`,
      value: model
    })),
    default: ws.config.selectedModel
  });
  await writeWorkspaceConfig(ws.paths, {
    ...ws.config,
    selectedModel: selected
  });
  success(`Model tersimpan: ${selected}`);
}
async function configureSkills() {
  header("Configure Skills");
  const ws = await ensureWorkspace();
  const picked = await checkbox({
    message: "Pilih skill yang aktif",
    choices: [
      {
        name: "Planner",
        value: "planner",
        checked: ws.config.skills.planner
      },
      {
        name: "Worker",
        value: "worker",
        checked: ws.config.skills.worker
      },
      {
        name: "Queen Guard",
        value: "queenGuard",
        checked: ws.config.skills.queenGuard
      }
    ]
  });
  const pickedSet = new Set(picked);
  await writeWorkspaceConfig(ws.paths, {
    ...ws.config,
    skills: {
      planner: pickedSet.has("planner"),
      worker: pickedSet.has("worker"),
      queenGuard: pickedSet.has("queenGuard")
    }
  });
  success("Konfigurasi skills tersimpan.");
}
async function healthCheck() {
  header("Health Check");
  const ws = await ensureWorkspace();
  const checks = [];
  checks.push(`${chalk.cyan("Workspace")}: ${ws.paths.workspaceRoot}`);
  checks.push(`${chalk.cyan("Config")}: ${fs2.existsSync(ws.paths.configFile) ? chalk.green("OK") : chalk.red("MISSING")}`);
  checks.push(`${chalk.cyan("Token")}: ${fs2.existsSync(ws.paths.tokenFile) ? chalk.green("OK") : chalk.yellow("MISSING")}`);
  checks.push(`${chalk.cyan("Port")}: ${chalk.green(String(ws.config.gatewayPort || 18410))}`);
  checks.push(`${chalk.cyan("Model")}: ${chalk.green(ws.config.selectedModel)}`);
  if (fs2.existsSync(ws.paths.pidFile)) {
    try {
      const pidRaw = await fsp2.readFile(ws.paths.pidFile, "utf8");
      const pid = Number.parseInt(pidRaw.trim(), 10);
      const running = Number.isInteger(pid) && pid > 0 && (() => {
        try {
          process2.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })();
      checks.push(`${chalk.cyan("Gateway")}: ${running ? chalk.green(`RUNNING (PID ${pid})`) : chalk.yellow("PID stale")}`);
    } catch {
      checks.push(`${chalk.cyan("Gateway")}: ${chalk.yellow("PID invalid")}`);
    }
  } else {
    checks.push(`${chalk.cyan("Gateway")}: ${chalk.yellow("OFF")}`);
  }
  console.log(checks.join("\n"));
}
async function printConfigureMenu() {
  return checkbox({
    message: chalk.cyan("Select sections to configure:"),
    choices: [
      { name: "\u25CB Workspace (Set workspace + sessions)", value: "workspace" },
      { name: "\u25CB Model", value: "model" },
      { name: "\u25CB Skills", value: "skills" },
      { name: "\u25CB Health check", value: "health" },
      { name: "\u25CB Continue", value: "continue" }
    ]
  });
}
async function runConfigureFlow() {
  header("Configure");
  while (true) {
    const sections = await printConfigureMenu();
    if (sections.includes("workspace")) {
      await configureWorkspace();
    }
    if (sections.includes("model")) {
      await configureModel();
    }
    if (sections.includes("skills")) {
      await configureSkills();
    }
    if (sections.includes("health")) {
      await healthCheck();
    }
    if (sections.includes("continue")) {
      success("Configure selesai.");
      return;
    }
    const again = await confirm({
      message: "Lanjutkan konfigurasi section lain?",
      default: true
    });
    if (!again) {
      return;
    }
  }
}
async function runForegroundCommand(command, args, cwd) {
  const effectiveCommand = process2.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  await new Promise((resolve, reject) => {
    const child = process2.platform === "win32" ? spawn(process2.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", [effectiveCommand, ...args].join(" ")], {
      cwd,
      stdio: "inherit"
    }) : spawn(effectiveCommand, args, {
      cwd,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${effectiveCommand} ${args.join(" ")} exit ${code ?? "null"}`));
      }
    });
  });
}
function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process2.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function gatewayStart() {
  header("Gateway Start");
  const ws = await ensureWorkspace();
  const gatewayPort = Number(ws.config.gatewayPort || 18410);
  if (fs2.existsSync(ws.paths.pidFile)) {
    const existing = Number.parseInt((await fsp2.readFile(ws.paths.pidFile, "utf8")).trim(), 10);
    if (isPidRunning(existing)) {
      warn(`Gateway sudah berjalan pada PID ${existing}.`);
      return;
    }
  }
  await runForegroundCommand("npm", ["run", "build:web"], ws.paths.projectRoot);
  const compiledServer = path2.join(ws.paths.projectRoot, "dist", "server.js");
  if (!fs2.existsSync(compiledServer)) {
    await runForegroundCommand("npm", ["run", "build"], ws.paths.projectRoot);
  }
  const child = spawn(process2.execPath, [compiledServer], {
    cwd: ws.paths.projectRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process2.env,
      AEGISNEXUS_WORKSPACE: ws.paths.workspaceRoot,
      AEGIS_NEXUS_PORT: String(gatewayPort)
    }
  });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (!isPidRunning(child.pid ?? 0)) {
    throw new Error(
      `Gateway gagal stay alive setelah start. Cek port ${gatewayPort} bentrok atau jalankan health check untuk detail.`
    );
  }
  await fsp2.writeFile(ws.paths.pidFile, `${child.pid}
`, "utf8");
  success(`Gateway berjalan di background (PID ${child.pid}).`);
}
async function gatewayStop() {
  header("Gateway Stop");
  const ws = await ensureWorkspace();
  if (!fs2.existsSync(ws.paths.pidFile)) {
    warn("PID file tidak ditemukan. Gateway dianggap sudah berhenti.");
    return;
  }
  const pid = Number.parseInt((await fsp2.readFile(ws.paths.pidFile, "utf8")).trim(), 10);
  if (!isPidRunning(pid)) {
    await fsp2.rm(ws.paths.pidFile, { force: true });
    warn("Process tidak aktif. PID file dibersihkan.");
    return;
  }
  process2.kill(pid);
  const waitUntil = Date.now() + 4e3;
  while (Date.now() < waitUntil && isPidRunning(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (isPidRunning(pid) && process2.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  }
  if (isPidRunning(pid)) {
    process2.kill(pid, "SIGKILL");
  }
  await fsp2.rm(ws.paths.pidFile, { force: true });
  success(`Gateway PID ${pid} dihentikan.`);
}
async function gatewayRestart() {
  await gatewayStop();
  await gatewayStart();
}
function createProgram() {
  const program = new Command();
  program.name("aegis").description("AegisNexus V2.0 CLI Controller").version("2.0.0");
  program.command("gateway").description("Start/stop/restart AegisNexus server daemon").argument("<action>", "start | stop | restart").action(async (action) => {
    const normalized = action.trim().toLowerCase();
    if (normalized === "start") {
      await gatewayStart();
      return;
    }
    if (normalized === "stop") {
      await gatewayStop();
      return;
    }
    if (normalized === "restart") {
      await gatewayRestart();
      return;
    }
    throw new Error("Action harus start|stop|restart.");
  });
  program.command("configure").description("Interactive configuration menu").action(async () => {
    await runConfigureFlow();
  });
  return program;
}
async function runAegisCli(argv) {
  try {
    await ensureWorkspace();
    const program = createProgram();
    await program.parseAsync(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    throw error;
  }
}

// index.ts
async function main() {
  const args = process3.argv.slice(2);
  if (!args.length) {
    console.log(chalk2.cyan("AegisNexus CLI Gateway"));
    console.log("Usage:");
    console.log("  node dist/index.js aegis gateway start");
    console.log("  node dist/index.js aegis configure");
    console.log("  node dist/index.js gateway start");
    return;
  }
  if (args[0] === "aegis") {
    await runAegisCli(["node", "aegis", ...args.slice(1)]);
    return;
  }
  await runAegisCli(["node", "aegis", ...args]);
}
void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk2.red(`Error: ${message}`));
  process3.exitCode = 1;
});

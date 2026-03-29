import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AegisWorkspaceConfig = {
  workspacePath: string;
  sessionKey: string;
  gatewayPort: number;
  selectedModel: string;
  skills: {
    planner: boolean;
    worker: boolean;
    queenGuard: boolean;
  };
};

export type AegisWorkspacePaths = {
  projectRoot: string;
  workspaceRoot: string;
  workspaceDir: string;
  agentsDir: string;
  orchestratorDir: string;
  plannersDir: string;
  workersDir: string;
  orchestratorMainFile: string;
  plannerArchitectFile: string;
  workerCoderFile: string;
  workerResearcherFile: string;
  workerExecutorFile: string;
  credentialsDir: string;
  memoryDir: string;
  skillsDir: string;
  logsDir: string;
  runtimeDir: string;
  configFile: string;
  tokenFile: string;
  pidFile: string;
  gatewayLogFile: string;
};

const __filename = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(__filename);
const PROJECT_ROOT = path.basename(CURRENT_DIR) === "dist" ? path.dirname(CURRENT_DIR) : CURRENT_DIR;
const WORKSPACE_POINTER_FILE = path.join(PROJECT_ROOT, ".aegisnexus.path");

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_GATEWAY_PORT = 18410;

export function getDefaultWorkspaceRoot(): string {
  if (process.platform === "win32") {
    return "L:\\.aegisnexus";
  }
  return path.join(os.homedir(), ".aegisnexus");
}

export function getConfiguredWorkspaceRoot(): string {
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

export function resolveWorkspacePaths(workspaceRoot = getConfiguredWorkspaceRoot()): AegisWorkspacePaths {
  const workspaceDir = path.join(workspaceRoot, "workspace");
  const agentsDir = path.join(workspaceDir, "agents");
  const orchestratorDir = path.join(agentsDir, "orchestrator");
  const plannersDir = path.join(agentsDir, "planners");
  const workersDir = path.join(agentsDir, "workers");

  return {
    projectRoot: PROJECT_ROOT,
    workspaceRoot,
    workspaceDir,
    agentsDir,
    orchestratorDir,
    plannersDir,
    workersDir,
    orchestratorMainFile: path.join(orchestratorDir, "main.md"),
    plannerArchitectFile: path.join(plannersDir, "architect.md"),
    workerCoderFile: path.join(workersDir, "coder.md"),
    workerResearcherFile: path.join(workersDir, "researcher.md"),
    workerExecutorFile: path.join(workersDir, "executor.md"),
    credentialsDir: path.join(workspaceRoot, "credentials"),
    memoryDir: path.join(workspaceRoot, "memory"),
    skillsDir: path.join(workspaceRoot, "skills"),
    logsDir: path.join(workspaceRoot, "logs"),
    runtimeDir: path.join(workspaceRoot, "runtime"),
    configFile: path.join(workspaceRoot, "aegisnexus.json"),
    tokenFile: path.join(workspaceRoot, "credentials", "github-copilot.token.json"),
    pidFile: path.join(workspaceRoot, "runtime", ".aegis.pid"),
    gatewayLogFile: path.join(workspaceRoot, "logs", "gateway.log"),
  };
}

export async function readWorkspaceConfig(paths: AegisWorkspacePaths): Promise<AegisWorkspaceConfig> {
  const raw = await fsp.readFile(paths.configFile, "utf8");
  const parsed = JSON.parse(raw) as Partial<AegisWorkspaceConfig>;

  return {
    workspacePath: String(parsed.workspacePath || paths.workspaceRoot),
    sessionKey: String(parsed.sessionKey || "main"),
    gatewayPort: Number(parsed.gatewayPort || DEFAULT_GATEWAY_PORT),
    selectedModel: String(parsed.selectedModel || DEFAULT_MODEL),
    skills: {
      planner: Boolean(parsed.skills?.planner ?? true),
      worker: Boolean(parsed.skills?.worker ?? true),
      queenGuard: Boolean(parsed.skills?.queenGuard ?? true),
    },
  };
}

export async function writeWorkspaceConfig(paths: AegisWorkspacePaths, config: AegisWorkspaceConfig): Promise<void> {
  const payload = `${JSON.stringify(config, null, 2)}\n`;
  await fsp.writeFile(paths.configFile, payload, "utf8");
}

export async function setWorkspacePointer(workspaceRoot: string): Promise<void> {
  await fsp.writeFile(WORKSPACE_POINTER_FILE, `${path.resolve(workspaceRoot)}\n`, "utf8");
}

export async function ensureWorkspace(workspaceRoot = getConfiguredWorkspaceRoot()): Promise<{
  paths: AegisWorkspacePaths;
  config: AegisWorkspaceConfig;
}> {
  let paths = resolveWorkspacePaths(workspaceRoot);

  const createDirectories = async (target: AegisWorkspacePaths): Promise<void> => {
    await Promise.all([
      fsp.mkdir(target.workspaceRoot, { recursive: true }),
      fsp.mkdir(target.credentialsDir, { recursive: true }),
      fsp.mkdir(target.memoryDir, { recursive: true }),
      fsp.mkdir(target.skillsDir, { recursive: true }),
      fsp.mkdir(target.logsDir, { recursive: true }),
      fsp.mkdir(target.runtimeDir, { recursive: true }),
      fsp.mkdir(target.workspaceDir, { recursive: true }),
      fsp.mkdir(target.agentsDir, { recursive: true }),
      fsp.mkdir(target.orchestratorDir, { recursive: true }),
      fsp.mkdir(target.plannersDir, { recursive: true }),
      fsp.mkdir(target.workersDir, { recursive: true }),
    ]);
  };

  const ensureFileWithDefault = async (filePath: string, content: string): Promise<void> => {
    try {
      await fsp.access(filePath);
    } catch {
      await fsp.writeFile(filePath, `${content.trim()}\n`, "utf8");
    }
  };

  try {
    await createDirectories(paths);
  } catch {
    const requestedDefault = path.resolve(workspaceRoot) === path.resolve(getDefaultWorkspaceRoot());
    if (!(process.platform === "win32" && requestedDefault)) {
      throw new Error(`Gagal membuat workspace di ${workspaceRoot}`);
    }

    const fallbackRoot = path.join(os.homedir(), ".aegisnexus");
    paths = resolveWorkspacePaths(fallbackRoot);
    await createDirectories(paths);
  }

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
        queenGuard: true,
      },
    });
  }

  await Promise.all([
    ensureFileWithDefault(
      paths.orchestratorMainFile,
      [
        "# The Queen - Orchestrator",
        "",
        "You are The Queen, the main orchestrator for AegisNexus.",
        "Prioritize safe execution, clear delegation, and concise final responses.",
      ].join("\n"),
    ),
    ensureFileWithDefault(
      paths.plannerArchitectFile,
      [
        "# Architect Planner",
        "",
        "Break complex goals into ordered, verifiable subtasks.",
        "Highlight risks, dependencies, and rollback options.",
      ].join("\n"),
    ),
    ensureFileWithDefault(
      paths.workerCoderFile,
      [
        "# Coder Worker",
        "",
        "Implement code changes with minimal blast radius.",
        "Preserve interfaces unless explicit migration is requested.",
      ].join("\n"),
    ),
    ensureFileWithDefault(
      paths.workerResearcherFile,
      [
        "# Researcher Worker",
        "",
        "Collect relevant facts quickly and report confidence level.",
        "Cite exact technical evidence from code or docs.",
      ].join("\n"),
    ),
    ensureFileWithDefault(
      paths.workerExecutorFile,
      [
        "# Executor Worker",
        "",
        "Run planned steps safely and verify outcomes.",
        "Stop and report blockers immediately when they appear.",
      ].join("\n"),
    ),
  ]);

  const config = await readWorkspaceConfig(paths);
  return { paths, config };
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`UI element tidak ditemukan: ${id}`);
  }
  return element as T;
}

const chatList = requireElement<HTMLDivElement>("chatList");
const logList = requireElement<HTMLDivElement>("logList");
const personaBox = requireElement<HTMLDivElement>("personaBox");
const promptInput = requireElement<HTMLTextAreaElement>("promptInput");
const sendBtn = requireElement<HTMLButtonElement>("sendBtn");
const continueBtn = requireElement<HTMLButtonElement>("continueBtn");
const modeSelect = requireElement<HTMLSelectElement>("modeSelect");
const plannerToggle = requireElement<HTMLInputElement>("plannerToggle");
const workerToggle = requireElement<HTMLInputElement>("workerToggle");
const activeMode = requireElement<HTMLDivElement>("activeMode");
const activeAgent = requireElement<HTMLDivElement>("activeAgent");
const themeToggle = requireElement<HTMLButtonElement>("themeToggle");
const themeIcon = requireElement<HTMLElement>("themeIcon");

type LogPayload = {
  level?: string;
  scope?: string;
  message?: string;
  at?: string;
};

type ChatResult = {
  answer: string;
  model: string;
  iteration: number;
  needsApproval: boolean;
  execution?: {
    mode: string;
    path: string;
    activeAgents: string[];
  };
};

type AgentControl = {
  mode: "general" | "full" | "custom";
  enablePlanner: boolean;
  enableWorker: boolean;
};

let sessionId = crypto.randomUUID();
let lastUserPrompt = "";
let waiting = false;
let needsApproval = false;
let activeTheme: "dark" | "light" = "dark";
let agentControl: AgentControl = {
  mode: "full",
  enablePlanner: true,
  enableWorker: true,
};

function updateModeIndicator(): void {
  activeMode.textContent = `Mode: ${agentControl.mode}`;
}

function updateControlAvailability(): void {
  const custom = agentControl.mode === "custom";
  plannerToggle.disabled = !custom;
  workerToggle.disabled = !custom;
}

function updateActiveAgentIndicator(agentName: string): void {
  activeAgent.textContent = `Agent: ${agentName}`;
}

function applyTheme(theme: "dark" | "light"): void {
  activeTheme = theme;
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
  themeIcon.className =
    theme === "dark"
      ? "ri-moon-line text-lg text-cyan-200"
      : "ri-sun-line text-lg text-amber-500";
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Dark mode active" : "Light mode active");
  localStorage.setItem("aegisnexus-theme", theme);
}

function bootstrapTheme(): void {
  const stored = localStorage.getItem("aegisnexus-theme");
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return;
  }
  applyTheme("dark");
}

function addChat(role: "user" | "assistant" | "meta", text: string): void {
  const row = document.createElement("div");
  row.className = role === "user" ? "flex justify-end" : "flex justify-start";

  const container = document.createElement("div");
  container.className =
    role === "user"
      ? "flex max-w-[88%] items-start gap-3"
      : "flex max-w-[88%] items-start gap-3";

  const avatar = document.createElement("div");
  avatar.className =
    role === "user"
      ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/25 text-xs font-bold text-cyan-100"
      : role === "assistant"
        ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-400/25 text-xs font-bold text-indigo-100"
        : "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-xs font-bold text-amber-100";
  avatar.textContent = role === "user" ? "U" : role === "assistant" ? "Q" : "!";

  const bubble = document.createElement("div");
  bubble.className =
    role === "user"
      ? "chat-bubble-user rounded-2xl rounded-tr-sm bg-cyan-400/15 px-4 py-3 text-sm leading-relaxed text-cyan-50"
      : role === "assistant"
        ? "chat-bubble-assistant rounded-2xl rounded-tl-sm bg-white/5 px-4 py-3 text-sm leading-relaxed text-gray-100"
        : "chat-bubble-meta rounded-2xl bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100";
  bubble.textContent = text;

  if (role === "user") {
    container.appendChild(bubble);
    container.appendChild(avatar);
  } else {
    container.appendChild(avatar);
    container.appendChild(bubble);
  }

  row.appendChild(container);
  chatList.appendChild(row);
  chatList.scrollTop = chatList.scrollHeight;
}

function addLog(entry: LogPayload): void {
  const item = document.createElement("div");
  const level = String(entry.level || "info");
  const colorClass =
    level === "error"
      ? "text-rose-200"
      : level === "warn"
        ? "text-amber-200"
        : "text-gray-300";
  item.className = `log-item rounded-xl bg-white/5 px-3 py-2 text-xs leading-relaxed ${colorClass}`;
  item.textContent = `[${entry.at || new Date().toISOString()}] ${entry.scope || "system"} - ${entry.message || ""}`;
  logList.prepend(item);
}

async function loadConfig(): Promise<void> {
  const res = await fetch("/api/config");
  const cfg = (await res.json()) as {
    persona: { name: string; maxAutoIterations: number };
    preferredModels: string[];
    defaultAgentControl?: AgentControl;
  };
  personaBox.textContent = `${cfg.persona.name} | max loop: ${cfg.persona.maxAutoIterations} | models: ${cfg.preferredModels.join(", ")}`;

  if (cfg.defaultAgentControl) {
    agentControl = cfg.defaultAgentControl;
  }
  modeSelect.value = agentControl.mode;
  plannerToggle.checked = agentControl.enablePlanner;
  workerToggle.checked = agentControl.enableWorker;
  updateModeIndicator();
  updateControlAvailability();
}

function setBusy(state: boolean): void {
  waiting = state;
  sendBtn.disabled = state;
  continueBtn.disabled = state || !needsApproval;
}

async function callChat(params: { message: string; continueApproved: boolean }): Promise<ChatResult> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: params.message,
      continueApproved: params.continueApproved,
      sessionId,
      agentControl,
    }),
  });

  const data = (await res.json()) as { error?: string } & Partial<ChatResult>;
  if (!res.ok) {
    throw new Error(data.error || "Unknown error");
  }

  return {
    answer: String(data.answer || ""),
    model: String(data.model || "unknown"),
    iteration: Number(data.iteration || 0),
    needsApproval: Boolean(data.needsApproval),
    execution: data.execution as ChatResult["execution"],
  };
}

async function runChat(continueApproved = false): Promise<void> {
  const prompt = continueApproved ? lastUserPrompt : promptInput.value.trim();
  if (!prompt) {
    return;
  }

  if (!continueApproved) {
    lastUserPrompt = prompt;
    addChat("user", prompt);
    promptInput.value = "";
  } else {
    addChat("meta", "Approval diberikan. The Queen melanjutkan iterasi.");
  }

  setBusy(true);

  try {
    const result = await callChat({ message: prompt, continueApproved });
    addChat("assistant", `${result.answer}\n\n(model: ${result.model}, iterasi: ${result.iteration})`);
    needsApproval = result.needsApproval;
    continueBtn.disabled = !needsApproval;

    if (result.execution) {
      activeMode.textContent = `Mode: ${result.execution.mode}`;
      const active = result.execution.activeAgents.length
        ? result.execution.activeAgents.join(", ")
        : "queen";
      updateActiveAgentIndicator(active);
    }
  } catch (error) {
    addChat("meta", `Error: ${error instanceof Error ? error.message : String(error)}`);
    updateActiveAgentIndicator("error");
  } finally {
    setBusy(false);
  }
}

sendBtn.addEventListener("click", () => {
  void runChat(false);
});

continueBtn.addEventListener("click", () => {
  void runChat(true);
});

promptInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !waiting) {
    void runChat(false);
  }
});

modeSelect.addEventListener("change", () => {
  const nextMode = modeSelect.value as AgentControl["mode"];
  agentControl.mode = nextMode;
  updateModeIndicator();
  updateControlAvailability();
});

plannerToggle.addEventListener("change", () => {
  agentControl.enablePlanner = plannerToggle.checked;
});

workerToggle.addEventListener("change", () => {
  agentControl.enableWorker = workerToggle.checked;
});

themeToggle.addEventListener("click", () => {
  applyTheme(activeTheme === "dark" ? "light" : "dark");
});

const events = new EventSource("/api/events");
events.onmessage = (event: MessageEvent<string>) => {
  try {
    const payload = JSON.parse(event.data) as LogPayload;
    addLog(payload);

    const scope = String(payload.scope || "").toLowerCase();
    if (scope === "queen" || scope === "planner" || scope === "worker") {
      updateActiveAgentIndicator(scope);
    }
  } catch {
    addLog({ level: "warn", scope: "events", message: event.data });
  }
};

events.onerror = () => {
  addLog({ level: "warn", scope: "events", message: "Log stream disconnected" });
};

void loadConfig().catch((error: unknown) => {
  addChat("meta", `Gagal load config: ${error instanceof Error ? error.message : String(error)}`);
});

bootstrapTheme();
updateModeIndicator();
updateControlAvailability();
updateActiveAgentIndicator("idle");

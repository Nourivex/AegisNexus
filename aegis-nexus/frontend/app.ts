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

function addChat(role: "user" | "assistant" | "meta", text: string): void {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatList.appendChild(div);
  chatList.scrollTop = chatList.scrollHeight;
}

function addLog(entry: LogPayload): void {
  const item = document.createElement("div");
  item.className = `log-item ${entry.level || "info"}`;
  item.textContent = `[${entry.at || new Date().toISOString()}] ${entry.scope || "system"}: ${entry.message || ""}`;
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

updateModeIndicator();
updateControlAvailability();
updateActiveAgentIndicator("idle");

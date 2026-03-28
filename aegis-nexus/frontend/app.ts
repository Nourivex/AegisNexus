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
};

let sessionId = crypto.randomUUID();
let lastUserPrompt = "";
let waiting = false;
let needsApproval = false;

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
  };
  personaBox.textContent = `${cfg.persona.name} | max loop: ${cfg.persona.maxAutoIterations} | models: ${cfg.preferredModels.join(", ")}`;
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
  } catch (error) {
    addChat("meta", `Error: ${error instanceof Error ? error.message : String(error)}`);
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

const events = new EventSource("/api/events");
events.onmessage = (event: MessageEvent<string>) => {
  try {
    addLog(JSON.parse(event.data) as LogPayload);
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

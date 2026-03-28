"use strict";
function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`UI element tidak ditemukan: ${id}`);
    }
    return element;
}
const chatList = requireElement("chatList");
const logList = requireElement("logList");
const personaBox = requireElement("personaBox");
const promptInput = requireElement("promptInput");
const sendBtn = requireElement("sendBtn");
const continueBtn = requireElement("continueBtn");
const modeSelect = requireElement("modeSelect");
const plannerToggle = requireElement("plannerToggle");
const workerToggle = requireElement("workerToggle");
const activeMode = requireElement("activeMode");
const activeAgent = requireElement("activeAgent");
let sessionId = crypto.randomUUID();
let lastUserPrompt = "";
let waiting = false;
let needsApproval = false;
let agentControl = {
    mode: "full",
    enablePlanner: true,
    enableWorker: true,
};
function updateModeIndicator() {
    activeMode.textContent = `Mode: ${agentControl.mode}`;
}
function updateControlAvailability() {
    const custom = agentControl.mode === "custom";
    plannerToggle.disabled = !custom;
    workerToggle.disabled = !custom;
}
function updateActiveAgentIndicator(agentName) {
    activeAgent.textContent = `Agent: ${agentName}`;
}
function addChat(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    chatList.appendChild(div);
    chatList.scrollTop = chatList.scrollHeight;
}
function addLog(entry) {
    const item = document.createElement("div");
    item.className = `log-item ${entry.level || "info"}`;
    item.textContent = `[${entry.at || new Date().toISOString()}] ${entry.scope || "system"}: ${entry.message || ""}`;
    logList.prepend(item);
}
async function loadConfig() {
    const res = await fetch("/api/config");
    const cfg = (await res.json());
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
function setBusy(state) {
    waiting = state;
    sendBtn.disabled = state;
    continueBtn.disabled = state || !needsApproval;
}
async function callChat(params) {
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
    const data = (await res.json());
    if (!res.ok) {
        throw new Error(data.error || "Unknown error");
    }
    return {
        answer: String(data.answer || ""),
        model: String(data.model || "unknown"),
        iteration: Number(data.iteration || 0),
        needsApproval: Boolean(data.needsApproval),
        execution: data.execution,
    };
}
async function runChat(continueApproved = false) {
    const prompt = continueApproved ? lastUserPrompt : promptInput.value.trim();
    if (!prompt) {
        return;
    }
    if (!continueApproved) {
        lastUserPrompt = prompt;
        addChat("user", prompt);
        promptInput.value = "";
    }
    else {
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
    }
    catch (error) {
        addChat("meta", `Error: ${error instanceof Error ? error.message : String(error)}`);
        updateActiveAgentIndicator("error");
    }
    finally {
        setBusy(false);
    }
}
sendBtn.addEventListener("click", () => {
    void runChat(false);
});
continueBtn.addEventListener("click", () => {
    void runChat(true);
});
promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !waiting) {
        void runChat(false);
    }
});
modeSelect.addEventListener("change", () => {
    const nextMode = modeSelect.value;
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
events.onmessage = (event) => {
    try {
        const payload = JSON.parse(event.data);
        addLog(payload);
        const scope = String(payload.scope || "").toLowerCase();
        if (scope === "queen" || scope === "planner" || scope === "worker") {
            updateActiveAgentIndicator(scope);
        }
    }
    catch {
        addLog({ level: "warn", scope: "events", message: event.data });
    }
};
events.onerror = () => {
    addLog({ level: "warn", scope: "events", message: "Log stream disconnected" });
};
void loadConfig().catch((error) => {
    addChat("meta", `Gagal load config: ${error instanceof Error ? error.message : String(error)}`);
});
updateModeIndicator();
updateControlAvailability();
updateActiveAgentIndicator("idle");

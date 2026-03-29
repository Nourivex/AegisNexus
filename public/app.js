import { createSidebar } from "./components/sidebar.js";
import { createDashboard } from "./pages/dashboard.js";
function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`UI element tidak ditemukan: ${id}`);
    }
    return element;
}
const sidebarRoot = requireElement("sidebar-root");
const pageRoot = requireElement("page-root");
let sessionId = crypto.randomUUID();
let activeTheme = "dark";
let agentControl = {
    mode: "full",
    enablePlanner: true,
    enableWorker: true,
};
const sidebar = createSidebar({
    onModeChange(mode) {
        agentControl.mode = mode;
        sidebar.setActiveMode(mode);
        sidebar.setControlAvailability(mode === "custom");
    },
    onPlannerToggle(enabled) {
        agentControl.enablePlanner = enabled;
    },
    onWorkerToggle(enabled) {
        agentControl.enableWorker = enabled;
    },
    onThemeToggle() {
        applyTheme(activeTheme === "dark" ? "light" : "dark");
    },
});
const dashboard = createDashboard({
    getAgentControl() {
        return agentControl;
    },
    getSessionId() {
        return sessionId;
    },
    onExecutionUpdate(execution) {
        if (!execution) {
            return;
        }
        const active = execution.activeAgents.length ? execution.activeAgents.join(", ") : "queen";
        sidebar.setActiveMode(execution.mode);
        sidebar.setActiveAgent(active);
    },
});
sidebarRoot.appendChild(sidebar.element);
pageRoot.appendChild(dashboard.element);
function applyTheme(theme) {
    activeTheme = theme;
    document.body.classList.remove("theme-dark", "theme-light");
    document.body.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    sidebar.setTheme(theme);
    localStorage.setItem("aegisnexus-theme", theme);
}
function bootstrapTheme() {
    const stored = localStorage.getItem("aegisnexus-theme");
    if (stored === "light" || stored === "dark") {
        applyTheme(stored);
        return;
    }
    applyTheme("dark");
}
async function loadConfig() {
    const res = await fetch("/api/config");
    const cfg = (await res.json());
    sidebar.setPersona(`${cfg.persona.name} | max loop: ${cfg.persona.maxAutoIterations} | models: ${cfg.preferredModels.join(", ")}`);
    if (cfg.defaultAgentControl) {
        agentControl = cfg.defaultAgentControl;
        sidebar.setMode(agentControl.mode);
        sidebar.setPlannerEnabled(agentControl.enablePlanner);
        sidebar.setWorkerEnabled(agentControl.enableWorker);
    }
    sidebar.setActiveMode(agentControl.mode);
    sidebar.setControlAvailability(agentControl.mode === "custom");
}
const events = new EventSource("/api/events");
events.onmessage = (event) => {
    try {
        const payload = JSON.parse(event.data);
        sidebar.addLog(payload);
        const scope = String(payload.scope || "").toLowerCase();
        if (scope === "queen" || scope === "planner" || scope === "worker") {
            sidebar.setActiveAgent(scope);
        }
    }
    catch {
        sidebar.addLog({ level: "warn", scope: "events", message: event.data });
    }
};
events.onerror = () => {
    sidebar.addLog({ level: "warn", scope: "events", message: "Log stream disconnected" });
};
void loadConfig().catch((error) => {
    dashboard.showError(`Gagal load config: ${error instanceof Error ? error.message : String(error)}`);
});
bootstrapTheme();
sidebar.setActiveMode(agentControl.mode);
sidebar.setControlAvailability(agentControl.mode === "custom");
sidebar.setActiveAgent("idle");
sessionId = crypto.randomUUID();

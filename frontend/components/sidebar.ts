export type AgentMode = "general" | "full" | "custom";

export type AgentControl = {
  mode: AgentMode;
  enablePlanner: boolean;
  enableWorker: boolean;
};

export type LogPayload = {
  level?: string;
  scope?: string;
  message?: string;
  at?: string;
};

type SidebarOptions = {
  onModeChange: (mode: AgentMode) => void;
  onPlannerToggle: (enabled: boolean) => void;
  onWorkerToggle: (enabled: boolean) => void;
  onThemeToggle: () => void;
};

export type SidebarController = {
  element: HTMLElement;
  setPersona: (text: string) => void;
  setMode: (mode: AgentMode) => void;
  setPlannerEnabled: (enabled: boolean) => void;
  setWorkerEnabled: (enabled: boolean) => void;
  setControlAvailability: (customMode: boolean) => void;
  setActiveMode: (mode: AgentMode) => void;
  setActiveAgent: (name: string) => void;
  setTheme: (theme: "dark" | "light") => void;
  addLog: (entry: LogPayload) => void;
};

export function createSidebar(options: SidebarOptions): SidebarController {
  const element = document.createElement("aside");
  element.className =
    "sidebar-panel flex max-h-[calc(100vh-2rem)] flex-col rounded-3xl bg-white/5 p-4 shadow-[0_0_45px_rgba(0,0,0,0.35)] ring-1 ring-white/10 backdrop-blur-xl lg:max-h-[calc(100vh-3rem)]";

  element.innerHTML = `
    <div class="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <i class="ri-shield-flash-line text-cyan-300"></i>
          <span>AegisNexus</span>
        </h1>
        <p class="text-sm text-gray-400">The Queen Orchestration Core</p>
      </div>
      <button id="themeToggle"
        class="theme-toggle-btn inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20"
        aria-label="Toggle theme">
        <i id="themeIcon" class="ri-moon-line text-lg text-cyan-200"></i>
      </button>
    </div>

    <div id="personaBox"
      class="card-panel mb-4 rounded-2xl bg-white/5 p-3 text-sm text-gray-300 ring-1 ring-white/10"></div>

    <div class="card-panel mb-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-300">Agent Control</h2>

      <label class="mb-3 block text-xs text-gray-400">Routing Mode</label>
      <select id="modeSelect"
        class="mb-4 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400">
        <option value="general">General Mode (Queen only)</option>
        <option value="full" selected>Full Orchestration</option>
        <option value="custom">Custom Override</option>
      </select>

      <div class="space-y-3 text-sm text-gray-200">
        <label class="flex items-center justify-between">
          <span class="flex items-center gap-2"><i class="ri-map-2-line"></i><span>Enable Planner</span></span>
          <span class="toggle-switch">
            <input type="checkbox" id="plannerToggle" checked />
            <span class="toggle-track"></span>
          </span>
        </label>
        <label class="flex items-center justify-between">
          <span class="flex items-center gap-2"><i class="ri-cpu-line"></i><span>Enable Worker</span></span>
          <span class="toggle-switch">
            <input type="checkbox" id="workerToggle" checked />
            <span class="toggle-track"></span>
          </span>
        </label>
      </div>
    </div>

    <div class="card-panel mb-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-300">Execution Indicator</h2>
      <div id="activeMode"
        class="mb-2 inline-flex rounded-full bg-indigo-400/15 px-3 py-1 text-xs font-medium text-indigo-200 ring-1 ring-indigo-300/30">
        Mode: full
      </div>
      <div id="activeAgent"
        class="inline-flex rounded-full bg-cyan-400/15 px-3 py-1 text-xs font-medium text-cyan-100 ring-1 ring-cyan-300/30">
        Agent: idle
      </div>
    </div>

    <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Agent/System Log</h2>
    <div id="logList" class="log-surface no-scrollbar flex-1 space-y-2 overflow-auto rounded-2xl bg-black/20 p-2"></div>
  `;

  const personaBox = element.querySelector<HTMLDivElement>("#personaBox");
  const modeSelect = element.querySelector<HTMLSelectElement>("#modeSelect");
  const plannerToggle = element.querySelector<HTMLInputElement>("#plannerToggle");
  const workerToggle = element.querySelector<HTMLInputElement>("#workerToggle");
  const activeMode = element.querySelector<HTMLDivElement>("#activeMode");
  const activeAgent = element.querySelector<HTMLDivElement>("#activeAgent");
  const logList = element.querySelector<HTMLDivElement>("#logList");
  const themeToggle = element.querySelector<HTMLButtonElement>("#themeToggle");
  const themeIcon = element.querySelector<HTMLElement>("#themeIcon");

  if (
    !personaBox ||
    !modeSelect ||
    !plannerToggle ||
    !workerToggle ||
    !activeMode ||
    !activeAgent ||
    !logList ||
    !themeToggle ||
    !themeIcon
  ) {
    throw new Error("Sidebar gagal diinisialisasi: element tidak lengkap.");
  }

  modeSelect.addEventListener("change", () => {
    const value = modeSelect.value as AgentMode;
    options.onModeChange(value);
  });

  plannerToggle.addEventListener("change", () => {
    options.onPlannerToggle(plannerToggle.checked);
  });

  workerToggle.addEventListener("change", () => {
    options.onWorkerToggle(workerToggle.checked);
  });

  themeToggle.addEventListener("click", () => {
    options.onThemeToggle();
  });

  return {
    element,
    setPersona(text: string) {
      personaBox.textContent = text;
    },
    setMode(mode: AgentMode) {
      modeSelect.value = mode;
    },
    setPlannerEnabled(enabled: boolean) {
      plannerToggle.checked = enabled;
    },
    setWorkerEnabled(enabled: boolean) {
      workerToggle.checked = enabled;
    },
    setControlAvailability(customMode: boolean) {
      plannerToggle.disabled = !customMode;
      workerToggle.disabled = !customMode;
    },
    setActiveMode(mode: AgentMode) {
      activeMode.textContent = `Mode: ${mode}`;
    },
    setActiveAgent(name: string) {
      activeAgent.textContent = `Agent: ${name}`;
    },
    setTheme(theme: "dark" | "light") {
      themeIcon.className =
        theme === "dark"
          ? "ri-moon-line text-lg text-cyan-200"
          : "ri-sun-line text-lg text-amber-500";
      themeToggle.setAttribute("aria-label", theme === "dark" ? "Dark mode active" : "Light mode active");
    },
    addLog(entry: LogPayload) {
      const item = document.createElement("div");
      const level = String(entry.level || "info");
      const colorClass =
        level === "error" ? "text-rose-200" : level === "warn" ? "text-amber-200" : "text-gray-300";
      item.className = `log-item rounded-xl bg-white/5 px-3 py-2 text-xs leading-relaxed ${colorClass}`;
      item.textContent = `[${entry.at || new Date().toISOString()}] ${entry.scope || "system"} - ${entry.message || ""}`;
      logList.prepend(item);
    },
  };
}

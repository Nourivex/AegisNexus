function mustQuery(container, selector) {
    const found = container.querySelector(selector);
    if (!found) {
        throw new Error(`Dashboard element tidak ditemukan: ${selector}`);
    }
    return found;
}
export function createDashboard(options) {
    const element = document.createElement("section");
    element.className =
        "main-panel relative flex h-screen w-full flex-col bg-[#0b1017] p-4 lg:p-6";
    element.innerHTML = `
    <div id="chatList" class="no-scrollbar mb-36 flex-1 space-y-4 overflow-auto pr-1"></div>

    <div class="pointer-events-none absolute inset-x-0 bottom-0 p-4 lg:p-6">
      <div class="composer-shell pointer-events-auto mx-auto max-w-4xl rounded-3xl bg-black/45 p-3 shadow-[0_0_30px_rgba(56,189,248,0.22)] ring-1 ring-cyan-300/20 backdrop-blur-2xl">
        <div class="flex items-end gap-3">
          <textarea id="promptInput" rows="2" placeholder="Tulis instruksi untuk The Queen..."
            class="max-h-40 min-h-[56px] flex-1 resize-y rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 outline-none focus:border-cyan-400"></textarea>
          <div class="flex items-center gap-2">
            <button id="continueBtn" disabled
              class="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-medium text-gray-300 transition hover:bg-white/10 disabled:opacity-40"
              aria-label="Lanjutkan">
              <i class="ri-play-list-add-line text-base"></i>
            </button>
            <button id="sendBtn"
              class="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              aria-label="Kirim">
              <i class="ri-send-plane-2-fill text-base"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
    const chatList = mustQuery(element, "#chatList");
    const promptInput = mustQuery(element, "#promptInput");
    const sendBtn = mustQuery(element, "#sendBtn");
    const continueBtn = mustQuery(element, "#continueBtn");
    let waiting = false;
    let needsApproval = false;
    let lastUserPrompt = "";
    function setBusy(state) {
        waiting = state;
        sendBtn.disabled = state;
        continueBtn.disabled = state || !needsApproval;
    }
    function addChat(role, text) {
        const row = document.createElement("div");
        row.className = role === "user" ? "flex justify-end" : "flex justify-start";
        const container = document.createElement("div");
        container.className = "flex max-w-[88%] items-start gap-3";
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
        }
        else {
            container.appendChild(avatar);
            container.appendChild(bubble);
        }
        row.appendChild(container);
        chatList.appendChild(row);
        chatList.scrollTop = chatList.scrollHeight;
    }
    async function callChat(params) {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: params.message,
                continueApproved: params.continueApproved,
                sessionId: options.getSessionId(),
                agentControl: options.getAgentControl(),
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
            options.onExecutionUpdate(result.execution);
        }
        catch (error) {
            addChat("meta", `Error: ${error instanceof Error ? error.message : String(error)}`);
            options.onExecutionUpdate({ mode: "general", path: "queen-direct", activeAgents: ["error"] });
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
    return {
        element,
        showError(text) {
            addChat("meta", text);
        },
    };
}

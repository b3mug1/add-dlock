"use strict";

const elements = {
  enabled: document.getElementById("enabled"),
  paused: document.getElementById("paused"),
  video: document.getElementById("video-exception"),
  channel: document.getElementById("channel-exception"),
  pageControls: document.getElementById("page-controls"),
  hiddenCount: document.getElementById("hidden-count"),
  skippedCount: document.getElementById("skipped-count"),
  diagnostics: document.getElementById("diagnostics"),
  status: document.getElementById("status")
};

let tabId = null;
let busy = false;
let state = null;

function showStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function render() {
  const page = state?.tab;
  elements.enabled.checked = state?.enabled ?? true;
  elements.enabled.disabled = busy || !state;
  elements.pageControls.hidden = !page;
  elements.paused.checked = page?.paused ?? false;
  elements.paused.disabled = busy || !page;
  elements.video.disabled = busy || !page?.context.videoId;
  elements.channel.disabled = busy || !page?.context.channelId;
  elements.video.textContent = page?.excludedVideo ? "Вернуть блокировку видео" : "Исключить видео";
  elements.channel.textContent = page?.excludedChannel ? "Вернуть блокировку канала" : "Исключить канал";
  elements.hiddenCount.textContent = String(state?.stats.hidden ?? 0);
  elements.skippedCount.textContent = String(state?.stats.skipped ?? 0);

  const mode = !state?.enabled ? "выключена везде"
    : !page ? "откройте страницу YouTube"
      : page.paused ? "пауза на вкладке"
        : page.excludedVideo ? "исключено видео"
          : page.excludedChannel ? "исключён канал"
            : "активна";
  elements.diagnostics.textContent = [
    `Защита: ${mode}`,
    `Сетевые правила: ${state?.rulesEnabled ? "включены" : "выключены"}`,
    `Видео: ${page?.context.videoId ?? "не определено"}`,
    `Канал: ${page?.context.channelId ?? "не определён"}`,
    `Исключений: ${state?.excludedVideoCount ?? 0} видео, ${state?.excludedChannelCount ?? 0} каналов`,
    "Счётчик отражает элементы страницы и ролики, а не все сетевые запросы."
  ].join("\n");
  showStatus(`Защита ${mode}`);
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE", tabId });
  if (response?.error) throw new Error(response.error);
  state = response;
  render();
}

async function perform(message) {
  busy = true;
  render();
  showStatus("Сохранение…");
  let failed = false;
  try {
    const response = await chrome.runtime.sendMessage({ ...message, tabId });
    if (response?.error) throw new Error(response.error);
    await refresh();
  } catch (_error) {
    failed = true;
  } finally {
    busy = false;
    render();
    if (failed) showStatus("Не удалось изменить настройку", true);
  }
}

elements.enabled.addEventListener("change", () => {
  void perform({ type: "SET_ENABLED", enabled: elements.enabled.checked });
});
elements.paused.addEventListener("change", () => {
  void perform({ type: "SET_TAB_PAUSED", paused: elements.paused.checked });
});
elements.video.addEventListener("click", () => {
  void perform({ type: "TOGGLE_EXCEPTION", kind: "video" });
});
elements.channel.addEventListener("click", () => {
  void perform({ type: "TOGGLE_EXCEPTION", kind: "channel" });
});

void (async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https:\/\/(?:[\w-]+\.)*youtube\.com\//.test(tab.url)) {
      tabId = tab.id;
      await chrome.tabs.sendMessage(tabId, { type: "REFRESH_STATE" }).catch(() => {});
    }
    await refresh();
  } catch (_error) {
    showStatus("Не удалось загрузить состояние", true);
  }
})();

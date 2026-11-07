"use strict";

const toggle = document.getElementById("enabled");
const status = document.getElementById("status");

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

chrome.storage.local.get("enabled", ({ enabled = true }) => {
  toggle.checked = enabled;
  toggle.disabled = false;
  showStatus(enabled ? "Защита активна" : "Защита выключена");
});

toggle.addEventListener("change", async () => {
  const requested = toggle.checked;
  toggle.disabled = true;
  showStatus("Сохранение…");

  try {
    const response = await chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: requested });
    if (response?.error) throw new Error(response.error);
    if (response?.enabled !== requested) throw new Error("Unexpected response");
    showStatus(requested ? "Защита активна" : "Защита выключена");
  } catch (_error) {
    toggle.checked = !requested;
    showStatus("Не удалось изменить настройку", true);
  } finally {
    toggle.disabled = false;
  }
});

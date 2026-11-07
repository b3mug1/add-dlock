"use strict";

const RULESET_ID = "youtube_ads";

async function setEnabled(enabled) {
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? [RULESET_ID] : [],
    disableRulesetIds: enabled ? [] : [RULESET_ID]
  });
  await chrome.storage.local.set({ enabled });
  return { enabled };
}

async function syncRuleset() {
  const { enabled = true } = await chrome.storage.local.get("enabled");
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? [RULESET_ID] : [],
    disableRulesetIds: enabled ? [] : [RULESET_ID]
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void syncRuleset();
});

chrome.runtime.onStartup.addListener(() => {
  void syncRuleset();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SET_ENABLED" || typeof message.enabled !== "boolean") {
    return false;
  }

  setEnabled(message.enabled)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});

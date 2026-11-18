"use strict";

const RULESET_ID = "youtube_ads";
const ALLOW_PRIORITY = 100;
const RESOURCE_TYPES = [
  "image", "xmlhttprequest", "sub_frame", "ping", "script",
  "stylesheet", "media", "font", "object"
];

function isTabId(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeContext(context) {
  return {
    videoId: typeof context?.videoId === "string" && /^[\w-]{11}$/.test(context.videoId)
      ? context.videoId : null,
    channelId: typeof context?.channelId === "string" &&
      /^(?:UC[\w-]{22}|@[\w.-]{3,30})$/.test(context.channelId)
      ? context.channelId : null
  };
}

async function setEnabled(enabled) {
  const { enabled: previous = true } = await chrome.storage.local.get("enabled");
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? [RULESET_ID] : [],
    disableRulesetIds: enabled ? [] : [RULESET_ID]
  });
  try {
    await chrome.storage.local.set({ enabled });
  } catch (error) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: previous ? [RULESET_ID] : [],
      disableRulesetIds: previous ? [] : [RULESET_ID]
    });
    throw error;
  }
  return { enabled };
}

async function syncRuleset() {
  const { enabled = true } = await chrome.storage.local.get("enabled");
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? [RULESET_ID] : [],
    disableRulesetIds: enabled ? [] : [RULESET_ID]
  });
}

async function getTabData() {
  const { pausedTabs = {}, tabContexts = {} } =
    await chrome.storage.session.get(["pausedTabs", "tabContexts"]);
  return { pausedTabs, tabContexts };
}

async function syncTab(tabId, context) {
  if (!isTabId(tabId)) throw new Error("Invalid tab");
  const session = await getTabData();
  if (context !== undefined) {
    session.tabContexts[tabId] = normalizeContext(context);
    await chrome.storage.session.set({ tabContexts: session.tabContexts });
  }
  const current = session.tabContexts[tabId] || { videoId: null, channelId: null };
  const { enabled = true, excludedVideos = [], excludedChannels = [] } =
    await chrome.storage.local.get(["enabled", "excludedVideos", "excludedChannels"]);
  const paused = session.pausedTabs[tabId] === true;
  const excludedVideo = Boolean(current.videoId && excludedVideos.includes(current.videoId));
  const excludedChannel = Boolean(current.channelId && excludedChannels.includes(current.channelId));
  const allow = paused || excludedVideo || excludedChannel;
  const existing = (await chrome.declarativeNetRequest.getSessionRules())
    .some((rule) => rule.id === tabId);
  if (allow !== existing) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing ? [tabId] : [],
      addRules: allow ? [{
        id: tabId,
        priority: ALLOW_PRIORITY,
        action: { type: "allow" },
        condition: {
          tabIds: [tabId],
          initiatorDomains: ["youtube.com"],
          resourceTypes: RESOURCE_TYPES
        }
      }] : []
    });
  }
  return {
    enabled,
    active: enabled && !allow,
    paused,
    excludedVideo,
    excludedChannel,
    context: current
  };
}

async function setTabPaused(tabId, paused) {
  if (!isTabId(tabId) || typeof paused !== "boolean") throw new Error("Invalid pause request");
  const { pausedTabs } = await getTabData();
  if (paused) pausedTabs[tabId] = true;
  else delete pausedTabs[tabId];
  await chrome.storage.session.set({ pausedTabs });
  const state = await syncTab(tabId);
  void chrome.tabs.sendMessage(tabId, { type: "REFRESH_STATE" }).catch(() => {});
  return state;
}

async function toggleException(tabId, kind) {
  if (!isTabId(tabId) || !["video", "channel"].includes(kind)) {
    throw new Error("Invalid exception request");
  }
  const { tabContexts } = await getTabData();
  const value = tabContexts[tabId]?.[kind === "video" ? "videoId" : "channelId"];
  if (!value) throw new Error("No video or channel on this page");
  const key = kind === "video" ? "excludedVideos" : "excludedChannels";
  const { [key]: stored = [] } = await chrome.storage.local.get(key);
  const values = stored.includes(value)
    ? stored.filter((item) => item !== value)
    : [...stored, value];
  await chrome.storage.local.set({ [key]: values });
  return syncTab(tabId);
}

async function getState(tabId) {
  const tab = isTabId(tabId) ? await syncTab(tabId) : null;
  const { enabled = true, stats = { hidden: 0, skipped: 0 },
    excludedVideos = [], excludedChannels = [] } =
    await chrome.storage.local.get(["enabled", "stats", "excludedVideos", "excludedChannels"]);
  const rulesEnabled = (await chrome.declarativeNetRequest.getEnabledRulesets())
    .includes(RULESET_ID);
  return { enabled, tab, stats, rulesEnabled,
    excludedVideoCount: excludedVideos.length,
    excludedChannelCount: excludedChannels.length };
}

let statsQueue = Promise.resolve();
let tabQueue = Promise.resolve();
function queueTab(task) {
  const result = tabQueue.then(task);
  tabQueue = result.catch(() => {});
  return result;
}

function reportStats(message) {
  const hidden = Number.isInteger(message.hidden) ? Math.max(0, Math.min(message.hidden, 100)) : 0;
  const skipped = Number.isInteger(message.skipped) ? Math.max(0, Math.min(message.skipped, 100)) : 0;
  if (!hidden && !skipped) return Promise.resolve();
  statsQueue = statsQueue.catch(() => {}).then(async () => {
    const { stats = { hidden: 0, skipped: 0 } } = await chrome.storage.local.get("stats");
    await chrome.storage.local.set({ stats: {
      hidden: stats.hidden + hidden,
      skipped: stats.skipped + skipped
    } });
  });
  return statsQueue;
}

chrome.runtime.onInstalled.addListener(() => { void syncRuleset().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void syncRuleset().catch(() => {}); });

chrome.tabs.onRemoved.addListener((tabId) => {
  void queueTab(async () => {
    const { pausedTabs, tabContexts } = await getTabData();
    delete pausedTabs[tabId];
    delete tabContexts[tabId];
    await chrome.storage.session.set({ pausedTabs, tabContexts });
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (rules.some((rule) => rule.id === tabId)) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
    }
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  let context = { videoId: null, channelId: null };
  try {
    const url = new URL(changeInfo.url);
    if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) {
      context = {
        videoId: url.pathname === "/watch" ? url.searchParams.get("v") :
          url.pathname.startsWith("/shorts/") ? url.pathname.split("/")[2] : null,
        channelId: url.pathname.match(/^\/(?:channel\/)?(UC[\w-]{22}|@[\w.-]{3,30})/)?.[1] || null
      };
    }
  } catch (_error) { /* clear stale context */ }
  void queueTab(() => syncTab(tabId, context)).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? message?.tabId;
  let task;
  switch (message?.type) {
    case "SET_ENABLED":
      if (typeof message.enabled !== "boolean") return false;
      task = setEnabled(message.enabled);
      break;
    case "SYNC_TAB_CONTEXT":
      if (!sender.tab || !/^https:\/\/(?:[\w-]+\.)*youtube\.com\//.test(sender.url || "")) return false;
      task = queueTab(() => syncTab(sender.tab.id, message.context));
      break;
    case "SET_TAB_PAUSED":
      task = queueTab(() => setTabPaused(tabId, message.paused));
      break;
    case "TOGGLE_EXCEPTION":
      task = queueTab(() => toggleException(tabId, message.kind));
      break;
    case "GET_STATE":
      task = queueTab(() => getState(message.tabId));
      break;
    case "REPORT_STATS":
      if (!sender.tab) return false;
      task = reportStats(message).then(() => ({ ok: true }));
      break;
    default:
      return false;
  }
  task.then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
});

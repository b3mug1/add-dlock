const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadScript(name, context) {
  vm.runInNewContext(fs.readFileSync(path.join(root, name), "utf8"), context, {
    filename: name
  });
}

test("popup setting updates network rules and storage together", async () => {
  let messageListener;
  const calls = [];
  const chrome = {
    tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    declarativeNetRequest: {
      updateEnabledRulesets: async (options) => calls.push(options)
    },
    storage: {
      local: {
        get: async () => ({ enabled: false }),
        set: async (value) => calls.push(value)
      }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    }
  };
  loadScript("background.js", { chrome });

  const response = await new Promise((resolve) => {
    assert.equal(messageListener({ type: "SET_ENABLED", enabled: false }, {}, resolve), true);
  });
  assert.equal(response.enabled, false);
  assert.deepEqual([...calls[0].disableRulesetIds], ["youtube_ads"]);
  assert.equal(calls[1].enabled, false);
});

test("player ad is skipped by jumping currentTime to duration", () => {
  let interval;
  let storageListener;
  let clicks = 0;

  let playCalls = 0;
  const video = {
    muted: false, playbackRate: 1, currentTime: 0, duration: 15, paused: false,
    play() { playCalls++; return Promise.resolve(); }
  };
  const button = { disabled: false, getClientRects: () => [1], click: () => { clicks++; } };

  const player = {
    querySelector(selector) {
      if (selector === ".ytp-ad-skip-button-modern") return button;
      if (selector === "video") return video;
      return null;
    }
  };

  let adShowing = true;
  const fakeBody = { nodeType: 1 };
  const document = {
    documentElement: { appendChild() {} },
    body: fakeBody,
    createElement: () => ({ id: "", textContent: "" }),
    getElementById: () => null,
    querySelector: (sel) => {
      if (sel.includes("ad-showing") && adShowing) return player;
      if (sel === ".html5-video-player video") return video;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener() {}
  };

  const chrome = {
    runtime: {
      sendMessage: async () => ({ active: true }),
      onMessage: { addListener() {} }
    },
    storage: {
      local: { get: (_key, callback) => callback({ enabled: true }) },
      onChanged: { addListener(listener) { storageListener = listener; } }
    }
  };

  loadScript("content.js", {
    chrome,
    document,
    URL,
    window: {
      setInterval(callback) { interval = callback; return 1; },
      postMessage() {},
      addEventListener() {},
      location: { origin: "https://www.youtube.com", href: "https://www.youtube.com/watch?v=abcdefghijk", pathname: "/watch" }
    },
    MutationObserver: class { observe() {} disconnect() {} }
  });

  // Во время рекламы: кнопка нажата, звук выключен, currentTime прыгнул к duration
  assert.ok(clicks > 0, "skip button should be clicked");
  assert.equal(video.muted, true, "video should be muted during ad");
  assert.equal(video.currentTime, video.duration, "currentTime should jump to duration");

  // Реклама закончилась — звук и скорость восстанавливаются
  adShowing = false;
  interval();
  assert.equal(video.muted, false, "muted should be restored after ad");
  assert.equal(video.playbackRate, 1, "playbackRate should be restored after ad");

  video.paused = true;
  interval();
  assert.equal(playCalls, 0, "a user-paused video should stay paused without an enforcement dialog");
});

test("video state is restored when extension is disabled mid-ad", () => {
  let storageListener;
  const postedStates = [];
  const video = { muted: false, playbackRate: 1, currentTime: 0, duration: 20 };
  const player = {
    querySelector(selector) {
      if (selector === "video") return video;
      return null;
    }
  };
  let adShowing = true;
  const fakeBody = { nodeType: 1 };
  const document = {
    documentElement: { appendChild() {} },
    body: fakeBody,
    createElement: () => ({ id: "", textContent: "" }),
    getElementById: () => null,
    querySelector: (sel) => sel.includes("ad-showing") && adShowing ? player : null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const chrome = {
    runtime: {
      sendMessage: async () => ({ active: true }),
      onMessage: { addListener() {} }
    },
    storage: {
      local: { get: (_key, callback) => callback({ enabled: true }) },
      onChanged: { addListener(listener) { storageListener = listener; } }
    }
  };
  loadScript("content.js", {
    chrome,
    document,
    URL,
    window: {
      setInterval() { return 1; },
      postMessage(message) { postedStates.push(message.enabled); },
      addEventListener() {},
      location: { origin: "https://www.youtube.com", href: "https://www.youtube.com/watch?v=abcdefghijk", pathname: "/watch" }
    },
    MutationObserver: class { observe() {} disconnect() {} }
  });

  assert.equal(video.muted, true, "muted during ad");

  // Пользователь выключает расширение
  storageListener({ enabled: { newValue: false } }, "local");
  assert.equal(video.muted, false, "muted restored after disable");
  assert.equal(video.playbackRate, 1, "playbackRate restored after disable");
  assert.deepEqual(postedStates, [true, false], "main-world state follows storage");
});

test("main-world script strips ad fields and follows the popup state", async () => {
  let messageListener;
  let attestationRequests = 0;
  const window = {
    addEventListener(type, listener) {
      if (type === "message") messageListener = listener;
    },
    fetch: async (input) => {
      if (String(input).includes("/youtubei/v1/att")) {
        attestationRequests++;
        return new Response('{"attestation":"ok"}', {
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({
        playabilityStatus: { status: "OK" },
        streamingData: { formats: [{ url: "https://video.example/stream" }] },
        adPlacements: [{}],
        adSlots: [{}],
        playerAds: [{}],
        auxiliaryUi: { message: "preserved player UI data" }
      }), { headers: { "content-type": "application/json" } });
    }
  };

  loadScript("inject.js", { window, Response, Headers, URL });

  window.ytInitialPlayerResponse = { playabilityStatus: { status: "OK" }, adPlacements: [{}] };
  assert.equal(window.ytInitialPlayerResponse.adPlacements, undefined);

  const filtered = await window.fetch("https://www.youtube.com/youtubei/v1/player");
  const filteredBody = await filtered.json();
  assert.equal(filteredBody.adSlots, undefined);
  assert.equal(filteredBody.playerAds, undefined);
  assert.equal(filteredBody.streamingData.formats[0].url, "https://video.example/stream");
  assert.equal(filteredBody.auxiliaryUi.message, "preserved player UI data");
  assert.equal(filteredBody.playabilityStatus.status, "OK");

  messageListener({ source: window, data: { source: "yt-ad-blocker", enabled: false } });
  window.ytInitialPlayerResponse = { adPlacements: [{}] };
  assert.equal(window.ytInitialPlayerResponse.adPlacements.length, 1);

  const unfiltered = await window.fetch("https://www.youtube.com/youtubei/v1/player");
  assert.equal((await unfiltered.json()).adSlots.length, 1);

  const attestation = await window.fetch("https://www.youtube.com/youtubei/v1/att");
  assert.deepEqual(await attestation.json(), { attestation: "ok" });
  assert.equal(attestationRequests, 1, "attestation request should reach YouTube");
});

test("manifest loads the player hook before the isolated content script", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const [injected, isolated] = manifest.content_scripts;
  assert.deepEqual(injected.js, ["inject.js"]);
  assert.equal(injected.world, "MAIN");
  assert.equal(injected.run_at, "document_start");
  assert.deepEqual(isolated.js, ["content.js"]);
  const rules = JSON.parse(fs.readFileSync(path.join(root, "rules.json"), "utf8"));
  assert.equal(
    rules.some((rule) => rule.condition.urlFilter?.includes("/youtubei/v1/att")),
    false,
    "attestation requests should not be blocked"
  );
});

test("global switch restores the previous ruleset when storage fails", async () => {
  let messageListener;
  const updates = [];
  const chrome = {
    tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    declarativeNetRequest: {
      updateEnabledRulesets: async (options) => updates.push(options)
    },
    storage: { local: {
      get: async () => ({ enabled: true }),
      set: async () => { throw new Error("Storage unavailable"); }
    } },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    }
  };
  loadScript("background.js", { chrome, URL });

  const response = await new Promise((resolve) => {
    messageListener({ type: "SET_ENABLED", enabled: false }, {}, resolve);
  });
  assert.match(response.error, /Storage unavailable/);
  assert.deepEqual([...updates[0].disableRulesetIds], ["youtube_ads"]);
  assert.deepEqual([...updates[1].enableRulesetIds], ["youtube_ads"]);
});

test("video exceptions and tab pause allow requests only in that tab", async () => {
  let messageListener;
  const local = { enabled: true, excludedVideos: [], excludedChannels: [] };
  const session = {};
  let rules = [];
  function read(store, keys) {
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, store[key]]));
  }
  const chrome = {
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      sendMessage: async () => {}
    },
    declarativeNetRequest: {
      getSessionRules: async () => rules,
      getEnabledRulesets: async () => ["youtube_ads"],
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        rules = rules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(addRules);
      }
    },
    storage: {
      local: {
        get: async (keys) => read(local, keys),
        set: async (values) => Object.assign(local, values)
      },
      session: {
        get: async (keys) => read(session, keys),
        set: async (values) => Object.assign(session, values)
      }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    }
  };
  loadScript("background.js", { chrome, URL });
  const send = (message, sender = {}) => new Promise((resolve) => {
    assert.equal(messageListener(message, sender, resolve), true);
  });
  const sender = { tab: { id: 7 }, url: "https://www.youtube.com/watch?v=abcdefghijk" };
  const channelId = `UC${"a".repeat(22)}`;
  await send({ type: "SYNC_TAB_CONTEXT", context: { videoId: "abcdefghijk", channelId } }, sender);
  const excluded = await send({ type: "TOGGLE_EXCEPTION", tabId: 7, kind: "video" });
  assert.equal(excluded.active, false);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].action.type, "allow");
  assert.deepEqual([...rules[0].condition.tabIds], [7]);

  const restored = await send({ type: "TOGGLE_EXCEPTION", tabId: 7, kind: "video" });
  assert.equal(restored.active, true);
  assert.equal(rules.length, 0);

  const paused = await send({ type: "SET_TAB_PAUSED", tabId: 7, paused: true });
  assert.equal(paused.active, false);
  assert.equal(rules.length, 1);
  const resumed = await send({ type: "SET_TAB_PAUSED", tabId: 7, paused: false });
  assert.equal(resumed.active, true);
  assert.equal(rules.length, 0);

  const channel = await send({ type: "TOGGLE_EXCEPTION", tabId: 7, kind: "channel" });
  assert.equal(channel.excludedChannel, true);
  assert.equal(rules.length, 1);
  await send({ type: "REPORT_STATS", hidden: 3, skipped: 1 }, sender);
  const state = await send({ type: "GET_STATE", tabId: 7 });
  assert.equal(state.rulesEnabled, true);
  assert.equal(state.stats.hidden, 3);
  assert.equal(state.stats.skipped, 1);
  assert.equal(state.excludedChannelCount, 1);
});

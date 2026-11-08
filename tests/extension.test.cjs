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

  const video = { muted: false, playbackRate: 1, currentTime: 0, duration: 15 };
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
    querySelector: (sel) => sel.includes("ad-showing") && adShowing ? player : null,
    addEventListener() {}
  };

  const chrome = {
    storage: {
      local: { get: (_key, callback) => callback({ enabled: true }) },
      onChanged: { addListener(listener) { storageListener = listener; } }
    }
  };

  loadScript("content.js", {
    chrome,
    document,
    window: {
      setInterval(callback) { interval = callback; return 1; }
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
});

test("video state is restored when extension is disabled mid-ad", () => {
  let storageListener;
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
    addEventListener() {}
  };
  const chrome = {
    storage: {
      local: { get: (_key, callback) => callback({ enabled: true }) },
      onChanged: { addListener(listener) { storageListener = listener; } }
    }
  };
  loadScript("content.js", {
    chrome,
    document,
    window: { setInterval() { return 1; } },
    MutationObserver: class { observe() {} disconnect() {} }
  });

  assert.equal(video.muted, true, "muted during ad");

  // Пользователь выключает расширение
  storageListener({ enabled: { newValue: false } }, "local");
  assert.equal(video.muted, false, "muted restored after disable");
  assert.equal(video.playbackRate, 1, "playbackRate restored after disable");
});

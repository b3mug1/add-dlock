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

test("player ads are skipped and normal playback settings are restored", () => {
  let interval;
  let storageListener;
  let clicks = 0;
  const video = { muted: false, playbackRate: 1 };
  const button = { disabled: false, getClientRects: () => [1], click: () => { clicks++; } };
  const player = {
    querySelector(selector) {
      if (selector === ".ytp-ad-skip-button-modern") return button;
      if (selector === "video") return video;
      return null;
    }
  };
  let adShowing = true;
  const document = {
    documentElement: { appendChild() {} },
    createElement: () => ({ id: "", textContent: "" }),
    getElementById: () => null,
    querySelector: () => adShowing ? player : null,
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
    window: { setInterval(callback) { interval = callback; } }
  });
  assert.ok(clicks > 0);
  assert.equal(video.muted, true);
  assert.equal(video.playbackRate, 16);

  adShowing = false;
  interval();
  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1);

  adShowing = true;
  interval();
  storageListener({ enabled: { newValue: false } }, "local");
  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1);
});

"use strict";

// Выполняется в MAIN world (контекст страницы).
// Перехватывает player-ответы и блокирует anti-adblock проверки YouTube.

(() => {
  const PLAYER_URL   = /\/youtubei\/v1\/player(\?|$)/;
  const ISOLATED_SOURCE = "yt-ad-blocker";

  // Поля рекламы которые нужно вырезать из player-ответа
  const AD_FIELDS = ["adPlacements", "adSlots", "playerAds"];

  let enabled = true;

  // ── Утилиты ────────────────────────────────────────────────────────────────

  function urlFromInput(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL)     return input.href;
    return input?.url ?? "";
  }

  function stripFields(obj, fields) {
    if (!obj || typeof obj !== "object") return obj;
    for (const f of fields) {
      try { delete obj[f]; } catch (_) {}
    }
    return obj;
  }

  // ── window.ytInitialPlayerResponse ─────────────────────────────────────────
  // Задаётся инлайн-скриптом страницы — перехватываем через setter.

  function hookInitialPlayerResponse() {
    let stored;
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get() { return stored; },
      set(value) {
        stored = enabled ? stripFields(value, AD_FIELDS) : value;
      }
    });
  }

  // ── fetch ──────────────────────────────────────────────────────────────────

  function hookFetch() {
    const orig = window.fetch;
    if (typeof orig !== "function") return;

    window.fetch = function(input, init) {
      const url = urlFromInput(input);
      const promise = orig.apply(this, arguments);
      if (!enabled) return promise;

      // Вырезаем рекламные поля из /player ответа
      if (PLAYER_URL.test(url)) {
        return promise.then(resp => resp?.ok ? rewriteJson(resp, data => stripFields(data, AD_FIELDS)) : resp);
      }

      return promise;
    };
  }

  async function rewriteJson(response, transform) {
    try {
      const data = await response.clone().json();
      transform(data);
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (_) {
      return response;
    }
  }

  // ── XMLHttpRequest ─────────────────────────────────────────────────────────

  function hookXhr() {
    if (typeof XMLHttpRequest !== "function") return;

    const urlMap  = new WeakMap();
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      urlMap.set(this, typeof url === "string" ? url : String(url));
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      const xhr = this;
      const url = urlMap.get(xhr) ?? "";

      if (enabled && PLAYER_URL.test(url)) {
        xhr.addEventListener("readystatechange", () => {
          if (xhr.readyState !== 4) return;
          try {
            const raw = xhr.responseText;
            const data = JSON.parse(raw);
            stripFields(data, AD_FIELDS);
            const body = JSON.stringify(data);
            Object.defineProperty(xhr, "responseText", { configurable: true, value: body });
            Object.defineProperty(xhr, "response",     { configurable: true, value: body });
          } catch (_) {}
        }, true);
      }

      return origSend.apply(this, args);
    };
  }

  // ── Синхронизация enabled с content.js ─────────────────────────────────────

  function hookMessaging() {
    window.addEventListener("message", (e) => {
      if (e.source !== window) return;
      if (e.data?.source !== ISOLATED_SOURCE) return;
      if (typeof e.data.enabled === "boolean") enabled = e.data.enabled;
    });
  }

  // ── Запуск ─────────────────────────────────────────────────────────────────

  try { hookMessaging();              } catch (_) {}
  try { hookInitialPlayerResponse();  } catch (_) {}
  try { hookFetch();                  } catch (_) {}
  try { hookXhr();                    } catch (_) {}
})();

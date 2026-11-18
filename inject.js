"use strict";

// Filter ad fields from player data in the page's main world. This can reduce
// player ad handling, but the page can still inspect or change these hooks.

(() => {
  const PLAYER_URL = /\/youtubei\/v1\/player(\?|$)/;
  const ISOLATED_SOURCE = "yt-ad-blocker";
  const AD_FIELDS = ["adPlacements", "adSlots", "playerAds"];

  let enabled = true;

  function hasAdFields(data) {
    return data && typeof data === "object" &&
      AD_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field));
  }

  function stripPlayerResponse(data) {
    if (!data || typeof data !== "object") return data;
    for (const field of AD_FIELDS) {
      try { delete data[field]; } catch (_error) { /* keep the original field */ }
    }
    return data;
  }

  function isPlayerUrl(url) {
    return typeof url === "string" && PLAYER_URL.test(url);
  }

  function urlFromRequest(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url || "";
  }

  // ── window.ytInitialPlayerResponse: присваивается инлайн-скриптом страницы ─
  function hookInitialPlayerResponse() {
    let stored;
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get() {
        return stored;
      },
      set(value) {
        stored = enabled ? stripPlayerResponse(value) : value;
      }
    });
  }

  // ── fetch: ответы /youtubei/v1/player при SPA-навигации ────────────────────
  function hookFetch() {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== "function") return;
    window.fetch = function (input, init) {
      const promise = originalFetch.apply(this, arguments);
      if (!enabled || !isPlayerUrl(urlFromRequest(input))) return promise;
      return promise.then((response) => {
        if (!response || !response.ok) return response;
        return rewritePlayerResponse(response);
      });
    };
  }

  async function rewritePlayerResponse(response) {
    try {
      const data = await response.clone().json();
      if (!hasAdFields(data)) return response;
      stripPlayerResponse(data);
      const headers = new Headers(response.headers);
      // тело уже декодировано, поэтому заголовки сжатия переносить нельзя
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (_error) {
      // не JSON или чтение не удалось — вернуть ответ без изменений
      return response;
    }
  }

  // ── XMLHttpRequest: запасной канал для тех же запросов ─────────────────────
  function hookXhr() {
    if (typeof XMLHttpRequest !== "function") return;
    const xhrUrls = new WeakMap();
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      xhrUrls.set(this, typeof url === "string" ? url : String(url));
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const xhr = this;
      if (enabled && isPlayerUrl(xhrUrls.get(xhr))) {
        xhr.addEventListener("readystatechange", () => {
          if (xhr.readyState !== 4) return;
          try {
            if (xhr.responseType === "json") {
              stripPlayerResponse(xhr.response);
            } else if (xhr.responseType === "" || xhr.responseType === "text") {
              const data = JSON.parse(xhr.responseText);
              if (!hasAdFields(data)) return;
              stripPlayerResponse(data);
              const body = JSON.stringify(data);
              // собственное свойство экземпляра затеняет нативный геттер прототипа
              Object.defineProperty(xhr, "responseText", { value: body });
              Object.defineProperty(xhr, "response", { value: body });
            }
          } catch (_error) {
            // не JSON — оставить ответ без изменений
          }
        }, true);
      }
      return originalSend.apply(this, args);
    };
  }

  // ── Синхронизация вкл/выкл с content.js (изолированный мир) ────────────────
  function hookMessaging() {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== ISOLATED_SOURCE) return;
      if (typeof event.data.enabled === "boolean") {
        enabled = event.data.enabled;
      }
    });
  }

  // Каждый хук независим: если один не сработал, остальные продолжают работать
  try { hookMessaging(); } catch (_error) { /* ignore */ }
  try { hookInitialPlayerResponse(); } catch (_error) { /* ignore */ }
  try { hookFetch(); } catch (_error) { /* ignore */ }
  try { hookXhr(); } catch (_error) { /* ignore */ }
})();

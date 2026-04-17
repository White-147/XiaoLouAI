/*
 * Universal URL rewriter + auto-login for Open WebUI under /openwebui.
 *
 * Two jobs:
 * 1. Rewrite all same-origin absolute paths to include /openwebui prefix.
 * 2. Before the SvelteKit app boots, check if there is already a token in
 *    localStorage.  If not, call the auto-signin endpoint (works when
 *    WEBUI_AUTH=false) and store the token.  This prevents the infinite
 *    redirect loop between the root layout and /auth.
 *
 * This script MUST execute synchronously before any application JS.
 */
(function () {
  "use strict";

  var PREFIX = "/openwebui";

  function isUnderPrefix() {
    try {
      return window.location.pathname.indexOf(PREFIX) === 0;
    } catch (_) {
      return false;
    }
  }

  if (!isUnderPrefix()) return;

  // =====================================================================
  // Part 1 — Auto-login
  //
  // When loaded inside the Playground iframe the parent page already did
  // an async pre-login and stored the token in localStorage (same origin).
  // The sync XHR below is only a safety net for direct /openwebui access.
  // We wrap it in a short-circuit check and swallow any errors so it
  // never blocks the page for more than ~4 s.
  // =====================================================================

  try {
    var existingToken = localStorage.getItem("token");
    if (!existingToken) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", PREFIX + "/api/v1/auths/signin", false);
      xhr.setRequestHeader("Content-Type", "application/json");
      try { xhr.send(JSON.stringify({ email: "", password: "" })); } catch (_sendErr) {}
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data && data.token) {
            localStorage.setItem("token", data.token);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  // =====================================================================
  // Part 2 — URL rewriting
  // =====================================================================

  function needsRewrite(path) {
    if (!path || typeof path !== "string") return false;
    if (path.indexOf(PREFIX + "/") === 0 || path === PREFIX) return false;
    if (path.charAt(0) !== "/") return false;
    if (path.indexOf("//") === 0) return false;
    return true;
  }

  function addPrefix(path) {
    return PREFIX + path;
  }

  function rewriteStringUrl(input) {
    if (typeof input !== "string") return input;
    if (input.charAt(0) === "/" && input.indexOf("//") !== 0) {
      return needsRewrite(input) ? addPrefix(input) : input;
    }
    try {
      var u = new URL(input);
      if (u.origin === window.location.origin && needsRewrite(u.pathname)) {
        u.pathname = addPrefix(u.pathname);
        return u.toString();
      }
    } catch (_) {}
    return input;
  }

  function rewriteAny(input) {
    if (typeof input === "string") return rewriteStringUrl(input);
    if (typeof URL !== "undefined" && input instanceof URL) {
      if (input.origin === window.location.origin && needsRewrite(input.pathname)) {
        var copy = new URL(input.toString());
        copy.pathname = addPrefix(copy.pathname);
        return copy;
      }
      return input;
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      var newUrl = rewriteStringUrl(input.url);
      return newUrl !== input.url ? new Request(newUrl, input) : input;
    }
    return input;
  }

  // ---- fetch ------------------------------------------------------------

  try {
    var _fetch = window.fetch;
    window.fetch = function (resource, init) {
      return _fetch.call(this, rewriteAny(resource), init);
    };
  } catch (_) {}

  // ---- XMLHttpRequest ---------------------------------------------------

  try {
    var _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      var a = Array.prototype.slice.call(arguments);
      if (typeof a[1] === "string") a[1] = rewriteStringUrl(a[1]);
      return _xhrOpen.apply(this, a);
    };
  } catch (_) {}

  // ---- EventSource ------------------------------------------------------

  try {
    if (typeof EventSource !== "undefined") {
      var _ES = EventSource;
      window.EventSource = function (url, cfg) { return new _ES(rewriteStringUrl(url), cfg); };
      window.EventSource.prototype = _ES.prototype;
      window.EventSource.CONNECTING = _ES.CONNECTING;
      window.EventSource.OPEN = _ES.OPEN;
      window.EventSource.CLOSED = _ES.CLOSED;
    }
  } catch (_) {}

  // ---- WebSocket --------------------------------------------------------

  try {
    if (typeof WebSocket !== "undefined") {
      var _WS = WebSocket;
      var PatchedWS = function (url, protocols) {
        var rewritten = url;
        if (typeof url === "string") {
          try {
            var p = new URL(url);
            if (
              (p.protocol === "ws:" || p.protocol === "wss:") &&
              p.hostname === window.location.hostname &&
              String(p.port || (p.protocol === "wss:" ? "443" : "80")) ===
                String(window.location.port || (window.location.protocol === "https:" ? "443" : "80"))
            ) {
              if (needsRewrite(p.pathname)) {
                p.pathname = addPrefix(p.pathname);
                rewritten = p.toString();
              }
            }
          } catch (_) {}
        }
        return arguments.length < 2 || protocols === undefined
          ? new _WS(rewritten)
          : new _WS(rewritten, protocols);
      };
      PatchedWS.prototype = _WS.prototype;
      PatchedWS.CONNECTING = _WS.CONNECTING;
      PatchedWS.OPEN = _WS.OPEN;
      PatchedWS.CLOSING = _WS.CLOSING;
      PatchedWS.CLOSED = _WS.CLOSED;
      window.WebSocket = PatchedWS;
    }
  } catch (_) {}

  // ---- Navigation: Location.prototype.assign / replace ------------------

  try {
    var _locAssign = Location.prototype.assign;
    Location.prototype.assign = function (url) {
      return _locAssign.call(this, rewriteStringUrl(url));
    };
  } catch (_) {}

  try {
    var _locReplace = Location.prototype.replace;
    Location.prototype.replace = function (url) {
      return _locReplace.call(this, rewriteStringUrl(url));
    };
  } catch (_) {}

  // ---- Navigation: history.pushState / replaceState ---------------------

  try {
    var _pushState = History.prototype.pushState;
    History.prototype.pushState = function (state, title, url) {
      if (typeof url === "string") url = rewriteStringUrl(url);
      return _pushState.call(this, state, title, url);
    };
  } catch (_) {}

  try {
    var _replaceState = History.prototype.replaceState;
    History.prototype.replaceState = function (state, title, url) {
      if (typeof url === "string") url = rewriteStringUrl(url);
      return _replaceState.call(this, state, title, url);
    };
  } catch (_) {}

  // ---- Navigation API (catches location.href = "..." in modern browsers) -

  try {
    if (typeof window.navigation !== "undefined" && window.navigation.addEventListener) {
      window.navigation.addEventListener("navigate", function (event) {
        if (!event.canIntercept || event.hashChange) return;
        try {
          var dest = new URL(event.destination.url);
          if (dest.origin === window.location.origin && needsRewrite(dest.pathname)) {
            var target = addPrefix(dest.pathname) + dest.search + dest.hash;
            event.intercept({
              handler: function () {
                window.location.replace(target);
                return new Promise(function () {});
              },
            });
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

  // ---- DOM: setAttribute("src"/"href", ...) -----------------------------

  try {
    var _setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if ((name === "src" || name === "href") && typeof value === "string" && needsRewrite(value)) {
        return _setAttribute.call(this, name, addPrefix(value));
      }
      return _setAttribute.call(this, name, value);
    };
  } catch (_) {}

  // ---- DOM: .src property setter ----------------------------------------

  try {
    [
      typeof HTMLImageElement !== "undefined" && HTMLImageElement,
      typeof HTMLScriptElement !== "undefined" && HTMLScriptElement,
      typeof HTMLSourceElement !== "undefined" && HTMLSourceElement,
      typeof HTMLAudioElement !== "undefined" && HTMLAudioElement,
      typeof HTMLVideoElement !== "undefined" && HTMLVideoElement,
      typeof HTMLIFrameElement !== "undefined" && HTMLIFrameElement,
    ].forEach(function (Ctor) {
      if (!Ctor) return;
      var desc = Object.getOwnPropertyDescriptor(Ctor.prototype, "src");
      if (!desc || !desc.set) return;
      var origSet = desc.set;
      Object.defineProperty(Ctor.prototype, "src", {
        get: desc.get,
        set: function (val) {
          return origSet.call(this, typeof val === "string" && needsRewrite(val) ? addPrefix(val) : val);
        },
        enumerable: desc.enumerable,
        configurable: true,
      });
    });
  } catch (_) {}
})();

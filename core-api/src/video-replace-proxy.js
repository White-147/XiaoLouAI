/**
 * video-replace-proxy.js — RETIRED
 *
 * This file previously reverse-proxied /api/video-replace and /vr-* to a
 * FastAPI sidecar on port 4200.  That architecture has been replaced:
 *
 *   OLD: browser → 3000 → 4100 (proxy) → 4200 (FastAPI)
 *   NEW: browser → 3000 → 4100 (native Node.js handler, no 4200)
 *
 * The implementation now lives in:
 *   core-api/src/video-replace-native.js
 *
 * This file is kept as a tombstone to prevent accidental re-introduction.
 * DO NOT import or require() this file.
 */
"use strict";

throw new Error(
  "video-replace-proxy.js has been retired. " +
    "Use video-replace-native.js instead. " +
    "See the comment at the top of this file."
);

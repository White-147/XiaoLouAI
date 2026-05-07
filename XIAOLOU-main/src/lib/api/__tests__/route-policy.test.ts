import { describe, expect, it } from "vitest";
import {
  CONTROL_API_CLIENT_EXACT_PATHS,
  CONTROL_API_CLIENT_PREFIXES,
  getRequestMethod,
  isControlApiClientPath,
  isLegacySurfacePath,
  shouldBlockLegacyMutatingRequest,
} from "../route-policy";

describe("Control API route policy", () => {
  it("keeps the exact Control API client allowlist stable", () => {
    expect(CONTROL_API_CLIENT_EXACT_PATHS).toEqual([
      "/api/accounts/ensure",
      "/api/capabilities",
      "/api/jobs",
      "/api/wallet",
      "/api/wallets",
      "/api/wallet/usage-stats",
      "/api/media/upload-begin",
      "/api/media/upload-complete",
      "/api/media/move-temp-to-permanent",
      "/api/media/signed-read-url",
      "/api/auth/providers",
      "/api/auth/google/exchange",
      "/api/auth/login",
      "/api/auth/admin/login",
      "/api/auth/demo-session",
      "/api/auth/register/personal",
      "/api/auth/register/enterprise-admin",
      "/api/me",
      "/api/api-center",
      "/api/api-center/defaults",
      "/api/admin/pricing-rules",
      "/api/admin/orders",
      "/api/enterprise-applications",
      "/api/playground/config",
      "/api/playground/models",
      "/api/playground/conversations",
      "/api/playground/chat",
      "/api/playground/chat-jobs",
      "/api/playground/memories",
      "/api/playground/memories/preference",
      "/api/toolbox",
      "/api/toolbox/capabilities",
      "/api/toolbox/character-replace",
      "/api/toolbox/motion-transfer",
      "/api/toolbox/upscale-restore",
      "/api/toolbox/video-reverse-prompt",
      "/api/toolbox/storyboard-grid25",
      "/api/toolbox/translate-text",
      "/api/projects",
      "/api/canvas-projects",
      "/api/agent-canvas/projects",
      "/api/create/images",
      "/api/create/videos",
    ]);

    for (const path of CONTROL_API_CLIENT_EXACT_PATHS) {
      expect(isControlApiClientPath(path), path).toBe(true);
      expect(isControlApiClientPath(`${path}?synthetic=1`), path).toBe(true);
    }
  });

  it("keeps the Control API client prefix allowlist stable", () => {
    expect(CONTROL_API_CLIENT_PREFIXES).toEqual([
      "/api/jobs/",
      "/api/wallets/",
      "/api/organizations/",
      "/api/api-center/",
      "/api/admin/",
      "/api/enterprise-applications/",
      "/api/playground/",
      "/api/toolbox/",
      "/api/projects/",
      "/api/canvas-projects/",
      "/api/agent-canvas/projects/",
      "/api/create/images/",
      "/api/create/videos/",
    ]);

    for (const prefix of CONTROL_API_CLIENT_PREFIXES) {
      expect(isControlApiClientPath(`${prefix}synthetic-id`), prefix).toBe(true);
      expect(isControlApiClientPath(`${prefix}synthetic-id?scoped=1`), prefix).toBe(true);
    }
  });

  it("does not broaden Control API client matching to sibling routes", () => {
    expect(isControlApiClientPath("/api/jobsx")).toBe(false);
    expect(isControlApiClientPath("/api/wallet-ledger")).toBe(false);
    expect(isControlApiClientPath("/api/administer")).toBe(false);
    expect(isControlApiClientPath("/api/video-replace/jobs/synthetic")).toBe(false);
  });

  it("keeps legacy surface detection and method normalization stable", () => {
    expect(getRequestMethod()).toBe("GET");
    expect(getRequestMethod({ method: " post " })).toBe("POST");
    expect(isLegacySurfacePath("/api/legacy-write")).toBe(true);
    expect(isLegacySurfacePath("/uploads/legacy.png")).toBe(true);
    expect(isLegacySurfacePath("/vr-result.mp4")).toBe(true);
    expect(isLegacySurfacePath("/jaaz/run")).toBe(true);
    expect(isLegacySurfacePath("/jaaz-api/run")).toBe(true);
    expect(isLegacySurfacePath("/assets/local.png")).toBe(false);
  });

  it("blocks only mutating legacy surface requests outside the Control API allowlist", () => {
    expect(shouldBlockLegacyMutatingRequest("/api/legacy-write", { method: "POST" })).toBe(true);
    expect(shouldBlockLegacyMutatingRequest("/api/legacy-write", { method: "GET" })).toBe(false);
    expect(shouldBlockLegacyMutatingRequest("/api/jobs", { method: "POST" })).toBe(false);
    expect(shouldBlockLegacyMutatingRequest("/api/jobs/synthetic/cancel", { method: "POST" })).toBe(false);
    expect(shouldBlockLegacyMutatingRequest("/jaaz/run", { method: "PUT" })).toBe(true);
    expect(shouldBlockLegacyMutatingRequest("/uploads/legacy.png", { method: "DELETE" })).toBe(true);
    expect(shouldBlockLegacyMutatingRequest("/api/video-replace/jobs", { method: "POST" })).toBe(true);
    expect(
      shouldBlockLegacyMutatingRequest("/api/legacy-write", { method: "POST" }, { allowLegacyMutations: true }),
    ).toBe(false);
  });
});

/** 演示用超级管理员身份 ID（仅应在本地回环访问时展示切换入口） */
export const SUPER_ADMIN_DEMO_ACTOR_ID = "root_demo_001";

/**
 * 当前页面是否通过本机回环地址访问（127.0.0.1 / localhost / ::1）。
 * 用于限制超级管理员演示账号：外网或局域网 IP 访问时为 false。
 * core-api 侧用 Origin/Referer/Host 做同类判断（见 `local-loopback-request.js`）。
 */
export function isLocalLoopbackAccess(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const h = window.location.hostname.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

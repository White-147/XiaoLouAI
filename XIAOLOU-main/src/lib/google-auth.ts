import { API_BASE_URL } from "./api";

export function getCurrentReturnTo() {
  if (typeof window === "undefined") return "/home";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function startGoogleLogin(returnTo = getCurrentReturnTo()) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams({
    returnTo,
    frontendOrigin: window.location.origin,
  });

  window.location.href = `${API_BASE_URL}/api/auth/google/start?${params.toString()}`;
}

export function removeGoogleLoginParams(search: string) {
  const params = new URLSearchParams(search);
  params.delete("googleLoginCode");
  params.delete("googleLoginError");
  params.delete("message");
  const next = params.toString();
  return next ? `?${next}` : "";
}

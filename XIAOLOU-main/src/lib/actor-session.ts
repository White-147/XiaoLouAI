import { useEffect, useState } from "react";

export const DEFAULT_ACTOR_ID = "guest";
const ACTOR_STORAGE_KEY = "xiaolou-current-actor-id";
const KNOWN_ACTORS_STORAGE_KEY = "xiaolou-known-actors";
const AUTH_TOKEN_KEY = "xiaolou-auth-token";
const ACTOR_CHANGE_EVENT = "xiaolou:actor-change";

export type KnownActor = {
  id: string;
  label: string;
  detail?: string;
  token?: string | null;
};

function normalizeActorId(actorId: string | null | undefined) {
  const normalized = typeof actorId === "string" ? actorId.trim() : "";
  return normalized || DEFAULT_ACTOR_ID;
}

function decodeActorIdFromAuthToken(token: string | null | undefined) {
  if (!token || typeof window === "undefined" || typeof window.atob !== "function") {
    return null;
  }

  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = window.atob(padded);
    const [actorId] = decoded.split(":", 2);
    const normalized = normalizeActorId(actorId);
    return normalized === DEFAULT_ACTOR_ID ? null : normalized;
  } catch {
    return null;
  }
}

function getStoredAuthActorId() {
  if (typeof window === "undefined") return null;
  return decodeActorIdFromAuthToken(window.localStorage.getItem(AUTH_TOKEN_KEY));
}

function readKnownActors(): KnownActor[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(KNOWN_ACTORS_STORAGE_KEY);
    const parsed = rawValue ? (JSON.parse(rawValue) as KnownActor[]) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.id === "string" && item.id.trim());
  } catch {
    return [];
  }
}

export function getCurrentActorId() {
  if (typeof window === "undefined") {
    return DEFAULT_ACTOR_ID;
  }

  const tokenActorId = getStoredAuthActorId();
  if (tokenActorId) {
    return tokenActorId;
  }

  return normalizeActorId(window.localStorage.getItem(ACTOR_STORAGE_KEY));
}

export function setCurrentActorId(actorId: string) {
  if (typeof window === "undefined") return;
  const nextActorId = normalizeActorId(actorId);
  window.localStorage.setItem(ACTOR_STORAGE_KEY, nextActorId);
  window.dispatchEvent(new CustomEvent(ACTOR_CHANGE_EVENT, { detail: nextActorId }));
}

export function rememberKnownActor(actor: KnownActor) {
  if (typeof window === "undefined") return;
  const nextActor: KnownActor = {
    id: normalizeActorId(actor.id),
    label: String(actor.label || actor.id).trim() || actor.id,
    detail: String(actor.detail || "").trim(),
    token: actor.token ?? null,
  };

  const nextKnownActors = [
    nextActor,
    ...readKnownActors().filter((item) => item.id !== nextActor.id),
  ].slice(0, 8);

  window.localStorage.setItem(KNOWN_ACTORS_STORAGE_KEY, JSON.stringify(nextKnownActors));
}

export function getKnownActorToken(actorId: string): string | null {
  const actor = readKnownActors().find((item) => item.id === actorId);
  return actor?.token ?? null;
}

export function removeKnownActor(actorId: string) {
  if (typeof window === "undefined") return;
  const nextKnownActors = readKnownActors().filter((item) => item.id !== actorId);
  window.localStorage.setItem(KNOWN_ACTORS_STORAGE_KEY, JSON.stringify(nextKnownActors));
}

export function getKnownActors() {
  return readKnownActors();
}

export function subscribeActorChange(listener: (actorId: string) => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === ACTOR_STORAGE_KEY || event.key === AUTH_TOKEN_KEY) {
      listener(getCurrentActorId());
    }
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<string>;
    listener(normalizeActorId(customEvent.detail));
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(ACTOR_CHANGE_EVENT, handleCustomEvent as EventListener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ACTOR_CHANGE_EVENT, handleCustomEvent as EventListener);
  };
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || null;
}

export function setAuthToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    const tokenActorId = decodeActorIdFromAuthToken(token);
    if (tokenActorId) {
      window.localStorage.setItem(ACTOR_STORAGE_KEY, tokenActorId);
      window.dispatchEvent(new CustomEvent(ACTOR_CHANGE_EVENT, { detail: tokenActorId }));
    }
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

export function logout() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  setCurrentActorId(DEFAULT_ACTOR_ID);
}

export function useActorId() {
  const [actorId, setActorId] = useState(DEFAULT_ACTOR_ID);

  useEffect(() => {
    setActorId(getCurrentActorId());
    return subscribeActorChange(setActorId);
  }, []);

  return actorId;
}

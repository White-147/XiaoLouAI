import { useEffect, useState } from "react";

export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "xiaolou-theme";
const THEME_CHANGE_EVENT = "xiaolou:theme-change";

function normalizeTheme(value: string | null | undefined): AppTheme | null {
  if (value === "light" || value === "dark") {
    return value;
  }

  return null;
}

function resolveSystemTheme(): AppTheme {
  // The product defaults to LIGHT mode. We still respect an explicit OS-level
  // "prefers-color-scheme: dark" preference when the user has not chosen a
  // theme yet, but the fallback is light (previously dark).
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

export function getCurrentTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY)) ?? resolveSystemTheme();
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") {
    return;
  }

  // Light is the default (defined in :root). Adding `.dark` opts into dark mode.
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function initializeTheme() {
  const theme = getCurrentTheme();
  applyTheme(theme);
  return theme;
}

export function setCurrentTheme(theme: AppTheme) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  applyTheme(theme);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<AppTheme>(THEME_CHANGE_EVENT, { detail: theme }),
    );
  }
}

export function subscribeThemeChange(listener: (theme: AppTheme) => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) {
      return;
    }

    const nextTheme = normalizeTheme(event.newValue) ?? resolveSystemTheme();
    applyTheme(nextTheme);
    listener(nextTheme);
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<AppTheme>;
    const nextTheme = normalizeTheme(customEvent.detail) ?? getCurrentTheme();
    applyTheme(nextTheme);
    listener(nextTheme);
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, handleCustomEvent as EventListener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, handleCustomEvent as EventListener);
  };
}

export function useTheme() {
  const [theme, setThemeState] = useState<AppTheme>(() => initializeTheme());

  useEffect(() => {
    setThemeState(initializeTheme());
    return subscribeThemeChange(setThemeState);
  }, []);

  const setTheme = (nextTheme: AppTheme | ((currentTheme: AppTheme) => AppTheme)) => {
    const resolvedTheme =
      typeof nextTheme === "function"
        ? nextTheme(getCurrentTheme())
        : nextTheme;

    setCurrentTheme(resolvedTheme);
    setThemeState(resolvedTheme);
  };

  return [theme, setTheme] as const;
}

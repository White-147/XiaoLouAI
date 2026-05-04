const retiredCacheNamePattern = /^(xiaolou|xiaolouai|workbox|vite-precache)-/i;

function isCurrentAppScope(scope: string) {
  try {
    const scopeUrl = new URL(scope);

    if (scopeUrl.origin !== window.location.origin) {
      return false;
    }

    return window.location.pathname.startsWith(scopeUrl.pathname);
  } catch {
    return false;
  }
}

export function retireStaticBuildServiceWorkers() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(
        registrations
          .filter((registration) => isCurrentAppScope(registration.scope))
          .map((registration) => registration.unregister()),
      ),
    )
    .catch(() => undefined);

  if (!("caches" in window)) {
    return;
  }

  void caches
    .keys()
    .then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => retiredCacheNamePattern.test(cacheName))
          .map((cacheName) => caches.delete(cacheName)),
      ),
    )
    .catch(() => undefined);
}

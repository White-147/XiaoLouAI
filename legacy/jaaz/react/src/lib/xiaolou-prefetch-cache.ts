type PrefetchEntry<T> = {
  cachedAt?: number
  ttlMs?: number
  payload?: T
}

export function readXiaolouPrefetchCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as PrefetchEntry<T>
    const cachedAt = Number(entry.cachedAt || 0)
    const ttlMs = Number(entry.ttlMs || 0)
    if (!cachedAt || !ttlMs || Date.now() - cachedAt > ttlMs) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return entry.payload ?? null
  } catch {
    return null
  }
}

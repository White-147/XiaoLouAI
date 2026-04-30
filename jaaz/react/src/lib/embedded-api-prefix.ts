import { getJaazApiBasePath, normalizeJaazApiUrl } from '@/lib/jaaz-url'

if (getJaazApiBasePath() && typeof window !== 'undefined') {
  const nativeFetch = window.fetch.bind(window)

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      return nativeFetch(normalizeJaazApiUrl(input), init)
    }

    if (input instanceof URL) {
      return nativeFetch(normalizeJaazApiUrl(input.toString()), init)
    }

    if (input instanceof Request) {
      const rewritten = normalizeJaazApiUrl(input.url)
      if (rewritten !== input.url) {
        return nativeFetch(new Request(rewritten, input), init)
      }
    }

    return nativeFetch(input, init)
  }
}

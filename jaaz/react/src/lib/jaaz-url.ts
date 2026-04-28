function normalizeApiBasePath(value?: string) {
  const trimmed = String(value || '').trim()
  if (!trimmed || trimmed === '/') return ''
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/$/, '')
}

export function getJaazApiBasePath() {
  return normalizeApiBasePath(import.meta.env.VITE_JAAZ_API_BASE_PATH)
}

function isLoopbackJaazApiOrigin(url: URL) {
  const hostname = url.hostname.toLowerCase()
  return (
    url.port === '57988' &&
    (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1')
  )
}

function shouldRewriteApiPath(pathname: string, apiBasePath: string) {
  return (
    Boolean(apiBasePath) &&
    (pathname === '/api' || pathname.startsWith('/api/')) &&
    !(pathname === apiBasePath || pathname.startsWith(`${apiBasePath}/`))
  )
}

export function normalizeJaazApiUrl(value?: string | null) {
  const raw = String(value || '').trim()
  const apiBasePath = getJaazApiBasePath()

  if (
    !raw ||
    !apiBasePath ||
    raw.startsWith('data:') ||
    raw.startsWith('blob:') ||
    raw.startsWith(apiBasePath)
  ) {
    return raw
  }

  if (raw.startsWith('/api/')) {
    return `${apiBasePath}${raw}`
  }

  try {
    const url = new URL(raw, window.location.origin)
    if (
      shouldRewriteApiPath(url.pathname, apiBasePath) &&
      (url.origin === window.location.origin || isLoopbackJaazApiOrigin(url))
    ) {
      return `${apiBasePath}${url.pathname}${url.search}${url.hash}`
    }
  } catch {
    return raw
  }

  return raw
}

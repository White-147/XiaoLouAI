export type XiaolouAgentAssetPayload = {
  fileUrl: string
  fileName?: string
  name?: string
  mediaKind?: 'image' | 'video'
  mimeType?: string
  width?: number
  height?: number
  canvasId?: string
  sessionId?: string
  source?: string
  prompt?: string
  description?: string
}

export type XiaolouAgentCanvasProjectPayload = {
  canvasId: string
  sessionId?: string
  title?: string
  thumbnailUrl?: string | null
  canvasUrl?: string
  source?: string
  savedAt?: string
  description?: string
}

export type XiaolouAgentCanvasProjectSaveResultPayload = {
  requestId?: string
  ok: boolean
  canvasId?: string
  error?: string
}

const DEFAULT_XIAOLOU_PARENT_ORIGIN = 'http://localhost:3001'

export type XiaolouTheme = 'light' | 'dark'

export type XiaolouThemeMessage =
  | {
      type: 'xiaolou:theme'
      theme: XiaolouTheme
    }
  | {
      type: 'xiaolou:theme:request'
    }
  | {
      type: 'xiaolou:theme:toggle'
    }
  | {
      type: 'xiaolou:theme:set'
      theme: XiaolouTheme
    }

export function getXiaolouParentTargetOrigin() {
  const configuredOrigins = String(
    import.meta.env.VITE_XIAOLOU_PARENT_ORIGIN || DEFAULT_XIAOLOU_PARENT_ORIGIN
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (typeof document !== 'undefined' && document.referrer) {
    try {
      const referrerOrigin = new URL(document.referrer).origin
      if (configuredOrigins.includes(referrerOrigin)) {
        return referrerOrigin
      }
    } catch {
      // Fall back to the configured origin below.
    }
  }

  return configuredOrigins[0] || DEFAULT_XIAOLOU_PARENT_ORIGIN
}

export function getAllowedXiaolouParentOrigins() {
  const configured = String(
    import.meta.env.VITE_XIAOLOU_PARENT_ORIGIN || DEFAULT_XIAOLOU_PARENT_ORIGIN
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const origins = new Set([
    ...configured,
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ])

  if (typeof window !== 'undefined') {
    origins.add(window.location.origin)
  }

  return origins
}

export function isXiaolouEmbedded() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const fromQuery =
    params.get('embed') === 'xiaolou' || params.get('xiaolouEmbed') === '1'
  const inFrame = window.parent !== window

  try {
    if (fromQuery) {
      window.sessionStorage.setItem('xiaolou-embed-mode', '1')
    }
    return (
      fromQuery ||
      (inFrame && window.sessionStorage.getItem('xiaolou-embed-mode') === '1')
    )
  } catch {
    return fromQuery
  }
}

export function postXiaolouThemeMessage(message: XiaolouThemeMessage) {
  if (
    typeof window === 'undefined' ||
    window.parent === window ||
    !isXiaolouEmbedded()
  ) {
    return
  }

  window.parent.postMessage(message, getXiaolouParentTargetOrigin())
}

export function fileNameFromJaazUrl(fileUrl?: string | null) {
  const raw = String(fileUrl || '').trim()
  if (!raw) return ''

  try {
    const parsed = new URL(raw, window.location.origin)
    const match = decodeURIComponent(parsed.pathname).match(
      /\/(?:jaaz\/)?api\/file\/([^/]+)$/
    )
    return match?.[1] || ''
  } catch {
    const match = raw.match(/\/(?:jaaz\/)?api\/file\/([^/?#]+)(?:[?#].*)?$/)
    return match?.[1] ? decodeURIComponent(match[1]) : ''
  }
}

export function postXiaolouAgentAsset(asset: XiaolouAgentAssetPayload) {
  if (
    typeof window === 'undefined' ||
    window.parent === window ||
    !asset?.fileUrl
  ) {
    return
  }

  window.parent.postMessage(
    {
      type: 'xiaolou:agent-asset:upsert',
      asset,
    },
    getXiaolouParentTargetOrigin()
  )
}

export function postXiaolouAgentCanvasProject(
  project: XiaolouAgentCanvasProjectPayload
) {
  if (
    typeof window === 'undefined' ||
    window.parent === window ||
    !project?.canvasId
  ) {
    return
  }

  window.parent.postMessage(
    {
      type: 'xiaolou:agent-canvas-project:upsert',
      project: {
        ...project,
        canvasUrl:
          project.canvasUrl ||
          `${window.location.pathname}${window.location.search}`,
        savedAt: project.savedAt || new Date().toISOString(),
      },
    },
    getXiaolouParentTargetOrigin()
  )
}

export function postXiaolouAgentCanvasProjectSaveResult(
  result: XiaolouAgentCanvasProjectSaveResultPayload
) {
  if (
    typeof window === 'undefined' ||
    window.parent === window
  ) {
    return
  }

  window.parent.postMessage(
    {
      type: 'xiaolou:agent-canvas-project:save-result',
      ...result,
    },
    getXiaolouParentTargetOrigin()
  )
}

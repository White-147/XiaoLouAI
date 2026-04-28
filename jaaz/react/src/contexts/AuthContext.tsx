import { createContext, useContext, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AuthStatus, getAuthStatus } from '../api/auth'

const DEFAULT_XIAOLOU_PARENT_ORIGIN = 'http://localhost:3001'

type XiaolouAuthMessage =
  | {
      type: 'xiaolou:auth'
      actorId?: string
      token?: string | null
      user?: {
        id?: string
        displayName?: string
        email?: string | null
        avatar?: string | null
      }
      platformRole?: string
    }
  | {
      type: 'xiaolou:auth:clear'
    }

function getAllowedXiaolouOrigins() {
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

function toXiaolouAuthStatus(message: Extract<XiaolouAuthMessage, { type: 'xiaolou:auth' }>): AuthStatus {
  const user = message.user || {}
  const username = String(user.displayName || user.email || 'Xiaolou User')
  const email = String(user.email || '')
  const id = String(user.id || message.actorId || email || 'xiaolou-user')

  return {
    status: 'logged_in',
    is_logged_in: true,
    auth_source: 'xiaolou',
    xiaolou_actor_id: message.actorId || id,
    platform_role: message.platformRole,
    user_info: {
      id,
      username,
      email,
      image_url: user.avatar || undefined,
      provider: 'xiaolou',
    },
  }
}

interface AuthContextType {
  authStatus: AuthStatus
  isLoading: boolean
  refreshAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    status: 'logged_out',
    is_logged_in: false,
  })
  const [isLoading, setIsLoading] = useState(true)

  const refreshAuth = async () => {
    try {
      setIsLoading(true)
      const status = await getAuthStatus()

      // Check if token expired based on the status returned by getAuthStatus
      if (status.tokenExpired) {
        toast.error('登录状态已过期，请重新登录', {
          duration: 5000,
        })
      }

      setAuthStatus(status)
    } catch (error) {
      console.error('获取认证状态失败:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshAuth()
  }, [])

  useEffect(() => {
    const allowedOrigins = getAllowedXiaolouOrigins()

    const handleMessage = (event: MessageEvent) => {
      if (!allowedOrigins.has(event.origin)) return
      const message = event.data as XiaolouAuthMessage
      if (!message || typeof message !== 'object') return

      if (message.type === 'xiaolou:auth') {
        setAuthStatus(toXiaolouAuthStatus(message))
        setIsLoading(false)
      }

      if (message.type === 'xiaolou:auth:clear') {
        setAuthStatus({
          status: 'logged_out',
          is_logged_in: false,
          auth_source: 'xiaolou',
        })
        setIsLoading(false)
      }
    }

    window.addEventListener('message', handleMessage)
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'xiaolou:auth:request' }, '*')
    }

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ authStatus, isLoading, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}

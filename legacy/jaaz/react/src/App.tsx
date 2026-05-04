// import InstallComfyUIDialog from '@/components/comfyui/InstallComfyUIDialog'
import UpdateNotificationDialog from '@/components/common/UpdateNotificationDialog'
import SettingsDialog from '@/components/settings/dialog'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ConfigsProvider } from '@/contexts/configs'
import { AuthProvider } from '@/contexts/AuthContext'
import { useTheme } from '@/hooks/use-theme'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { openDB } from 'idb'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { routeTree } from './route-tree.gen'
import { getAllowedXiaolouParentOrigins } from '@/lib/xiaolou-embed'

import '@/assets/style/App.css'
import '@/i18n'

function getRouterBasepath() {
  const basePath = new URL(import.meta.env.BASE_URL || '/', window.location.origin).pathname
  const normalized = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  if (!normalized || normalized === '/') return '/'
  return window.location.pathname === normalized || window.location.pathname.startsWith(`${normalized}/`)
    ? normalized
    : '/'
}

const router = createRouter({ routeTree, basepath: getRouterBasepath() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// 创建 IndexedDB 连接
const getDB = () =>
  openDB('react-query-db', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache')
      }
    },
  })

// 创建 IndexedDB 持久化器
const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => {
      const db = await getDB()
      return (await db.get('cache', key)) || null
    },
    setItem: async (key: string, value: unknown) => {
      const db = await getDB()
      await db.put('cache', value, key)
    },
    removeItem: async (key: string) => {
      const db = await getDB()
      await db.delete('cache', key)
    },
  },
  key: 'react-query-cache',
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
})

function App() {
  const { theme } = useTheme()

  useEffect(() => {
    const handleXiaolouNavigation = (event: MessageEvent) => {
      if (!getAllowedXiaolouParentOrigins().has(event.origin)) return
      if (event.source !== window.parent) return
      if (event.data?.type !== 'xiaolou:agent-canvas:navigate') return

      const canvasId = String(event.data.canvasId || '').trim()
      const sessionId = String(event.data.sessionId || '').trim()
      if (!canvasId) return

      router.navigate({
        to: '/canvas/$id',
        params: { id: canvasId },
        search: sessionId ? { sessionId } : {},
      })
    }

    window.addEventListener('message', handleXiaolouNavigation)
    return () => window.removeEventListener('message', handleXiaolouNavigation)
  }, [])

  // Auto-start ComfyUI on app startup
  useEffect(() => {
    const autoStartComfyUI = async () => {
      try {
        // Check if ComfyUI is installed
        const isInstalled = await window.electronAPI?.checkComfyUIInstalled()
        if (!isInstalled) {
          console.log('ComfyUI is not installed, skipping auto-start')
          return
        }

        // Start ComfyUI process
        console.log('Auto-starting ComfyUI...')
        const result = await window.electronAPI?.startComfyUIProcess()

        if (result?.success) {
          console.log('ComfyUI auto-started successfully:', result.message)
        } else {
          console.log('Failed to auto-start ComfyUI:', result?.message)
        }
      } catch (error) {
        console.error('Error during ComfyUI auto-start:', error)
      }
    }

    // Only run if electronAPI is available (in Electron environment)
    if (window.electronAPI) {
      autoStartComfyUI()
    }
  }, [])

  return (
    <ThemeProvider defaultTheme={theme} storageKey="vite-ui-theme">
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister }}
      >
        <AuthProvider>
          <ConfigsProvider>
            <div className="app-container">
              <RouterProvider router={router} />

              {/* Install ComfyUI Dialog */}
              {/* <InstallComfyUIDialog /> */}

              {/* Update Notification Dialog */}
              <UpdateNotificationDialog />

              {/* Settings Dialog */}
              <SettingsDialog />

              {/* Login Dialog */}
              <LoginDialog />
            </div>
          </ConfigsProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
      <Toaster position="bottom-center" richColors />
    </ThemeProvider>
  )
}

export default App

import { Theme, ThemeProviderContext } from '@/contexts/theme'
import {
  getAllowedXiaolouParentOrigins,
  isXiaolouEmbedded,
  postXiaolouThemeMessage,
} from '@/lib/xiaolou-embed'
import { useEffect, useState } from 'react'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light'

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  useEffect(() => {
    if (!isXiaolouEmbedded()) return

    const allowedOrigins = getAllowedXiaolouParentOrigins()

    const handleMessage = (event: MessageEvent) => {
      if (!allowedOrigins.has(event.origin)) return
      const data = event.data as {
        type?: string
        channel?: string
        direction?: string
        theme?: string
      } | null

      const nextTheme =
        data?.type === 'xiaolou:theme' ||
        (data?.channel === 'xiaolou.theme' && data?.direction === 'set')
          ? data.theme
          : null

      if (nextTheme !== 'light' && nextTheme !== 'dark') return

      localStorage.setItem(storageKey, nextTheme)
      setTheme(nextTheme)
    }

    window.addEventListener('message', handleMessage)
    postXiaolouThemeMessage({ type: 'xiaolou:theme:request' })

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [storageKey])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

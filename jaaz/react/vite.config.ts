import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig, loadEnv, UserConfig } from 'vite'

const PORT = 57988

function normalizeBasePath(value?: string) {
  const trimmed = String(value || '/').trim()
  if (!trimmed || trimmed === '/') return '/'
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function jaazBaseFallbackPlugin(basePath: string) {
  const normalizedBase = normalizeBasePath(basePath)
  const baseWithoutSlash = normalizedBase.replace(/\/$/, '')
  const ignoredPrefixes = [
    normalizedBase,
    '/api',
    '/ws',
    '/jaaz-api',
    '/socket.io',
    '/@vite',
    '/@react-refresh',
    '/src',
    '/node_modules',
  ]

  return {
    name: 'jaaz-base-fallback',
    configureServer(server: any) {
      server.middlewares.use((req: any, _res: any, next: () => void) => {
        const url = String(req.url || '/')
        const pathname = url.split('?')[0] || '/'
        const accept = String(req.headers?.accept || '')
        const isHtmlNavigation = req.method === 'GET' && accept.includes('text/html')
        const isAsset = /\.[a-zA-Z0-9]+$/.test(pathname)

        if (
          normalizedBase !== '/' &&
          isHtmlNavigation &&
          !isAsset &&
          !ignoredPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
        ) {
          req.url = `${baseWithoutSlash}${url}`
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isLibMode = mode === 'lib'
  const env = loadEnv(mode, '.', '')
  const basePath = normalizeBasePath(env.VITE_JAAZ_PUBLIC_BASE_PATH)

  // Base configuration that applies to all environments
  const config: UserConfig = {
    base: basePath,
    plugins: [
      !isLibMode && basePath !== '/' && jaazBaseFallbackPlugin(basePath),
      !isLibMode &&
        TanStackRouterVite({
          target: 'react',
          autoCodeSplitting: true,
          generatedRouteTree: 'src/route-tree.gen.ts',
        }),
      react(),
      tailwindcss(),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5174,
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: {},
    },
  }

  // Library build configuration
  if (isLibMode) {
    config.build = {
      lib: {
        entry: path.resolve(__dirname, 'src/index.ts'),
        name: '@jaaz/agent-ui',
        fileName: (format: string) => `index.${format}.js`,
        formats: ['es'],
      },
      rollupOptions: {
        external: [
          'react',
          'react-dom',
          'react/jsx-runtime',
          '@tanstack/react-router',
          '@tanstack/react-query',
          'i18next',
          'react-i18next',
          'framer-motion',
          'motion',
          'lucide-react',
          'sonner',
          'zustand',
          'immer',
          'nanoid',
          'ahooks',
          'socket.io-client',
          'openai',
          'clsx',
          'tailwind-merge',
          'class-variance-authority',
          /@radix-ui\/.*/,
          /@tanstack\/.*/,
          /@excalidraw\/.*/,
          /@mdxeditor\/.*/,
        ],
        output: {
          globals: {
            react: 'React',
            'react-dom': 'ReactDOM',
            'react/jsx-runtime': 'react/jsx-runtime',
          },
        },
      },
    }
  }

  // Configure server based on environment
  if (mode === 'development') {
    config.server = config.server || {}
    config.server.proxy = {
      '/api': {
        target: `http://127.0.0.1:${PORT}`,
        changeOrigin: true,
        // Uncomment the following if you want to remove the /api prefix when forwarding to Flask
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      // Also proxy WebSocket connections
      '/ws': {
        target: `ws://127.0.0.1:${PORT}`,
        ws: true,
      },
      '/jaaz-api': {
        target: `http://127.0.0.1:${PORT}`,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/jaaz-api(?=\/|$)/, '') || '/',
      },
      '/socket.io': {
        target: `ws://127.0.0.1:${PORT}`,
        ws: true,
      },
    }
  }

  return config
})

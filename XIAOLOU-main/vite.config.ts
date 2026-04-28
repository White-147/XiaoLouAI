import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiProxyTarget = env.VITE_CORE_API_PROXY_TARGET || 'http://127.0.0.1:4100';
  const jaazProxyTarget = env.VITE_JAAZ_DEV_PROXY_TARGET || 'http://localhost:5174';
  const jaazApiProxyTarget = env.VITE_JAAZ_API_PROXY_TARGET || 'http://127.0.0.1:57988';
  const canvasApiProxyTarget = env.VITE_CANVAS_API_PROXY_TARGET || env.VITE_TWITCANVA_API_PROXY_TARGET || apiProxyTarget;

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@canvas': path.resolve(__dirname, 'src/canvas'),
      },
    },
    server: {
      host: '::',
      allowedHosts: true,
      cors: true,
      proxy: {
        '/api/video-replace': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/vr-uploads': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/vr-thumbnails': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/vr-candidates': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/vr-keyframes': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/vr-references': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/vr-masks': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/vr-results': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/vr-finals': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/uploads': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/jaaz-api': {
          target: jaazApiProxyTarget,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/jaaz-api(?=\/|$)/, '') || '/',
        },
        '/jaaz': {
          target: jaazProxyTarget,
          changeOrigin: true,
          ws: true,
        },
        '/socket.io': {
          target: jaazApiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
        '/canvas-library': {
          target: canvasApiProxyTarget,
          changeOrigin: true,
        },
        '/twitcanva-api': {
          target: canvasApiProxyTarget,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/twitcanva-api/, '/api/canvas'),
        },
        '/twitcanva-library': {
          target: canvasApiProxyTarget,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/twitcanva-library/, '/canvas-library'),
        },
      },
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    preview: {
      host: '::',
      allowedHosts: true,
      cors: true,
    },
    build: {
      chunkSizeWarningLimit: 1000,
    },
  };
});

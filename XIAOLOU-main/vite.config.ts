import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

const OPEN_WEBUI_BASE_PATH = '/openwebui';

// ---------------------------------------------------------------------------
// Allowed model whitelist for Open WebUI.
// Only models listed here will appear in the Playground model picker.
// ---------------------------------------------------------------------------
const ALLOWED_OPENWEBUI_MODELS = [
  {
    id: 'doubao-seed-2-0-mini-260215',
    object: 'model',
    name: 'Doubao Seed 2.0 Mini',
    owned_by: 'volcengine',
  },
];

function createOpenWebUiModelsMiddleware() {
  // Intercept the two endpoints Open WebUI uses to list models:
  //   GET /openwebui/api/models            – UI model picker
  //   GET /openwebui/api/models/base       – base model list
  //   GET /openwebui/openai/models         – upstream passthrough
  const interceptPaths = new Set([
    `${OPEN_WEBUI_BASE_PATH}/openai/models`,
    `${OPEN_WEBUI_BASE_PATH}/api/models`,
    `${OPEN_WEBUI_BASE_PATH}/api/models/base`,
  ]);

  return (req: any, res: any, next: () => void) => {
    const url = (req.url as string).split('?')[0];
    if (req.method !== 'GET' || !interceptPaths.has(url)) {
      next();
      return;
    }

    // Return OpenAI-compatible model list format
    const payload = JSON.stringify({
      object: 'list',
      data: ALLOWED_OPENWEBUI_MODELS,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(payload));
    res.end(payload);
  };
}

function openWebUiModelsPlugin() {
  const middleware = createOpenWebUiModelsMiddleware();
  return {
    name: 'openwebui-models-filter',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

function rewriteOpenWebUiRequestPath(requestPath: string) {
  const rewritten = requestPath.replace(/^\/openwebui(?=\/|$)/, '');
  return rewritten || '/';
}

const OPEN_WEBUI_INJECT_STYLE = `
<style id="xiaolou-owui-overrides">
/* Hide user avatar / profile menu button in top-right navbar */
img.rounded-full[src*="/api/v1/users/"] { visibility: hidden !important; width: 0 !important; height: 0 !important; }
button:has(img.rounded-full) ~ div[role="menu"],
button:has(img.rounded-full) ~ div[data-menu-content] { display: none !important; }
nav button:has(> img.rounded-full),
nav button:has(img.rounded-full),
.sticky button:has(img.rounded-full),
div[class*="sticky"] button:has(img.rounded-full),
header button:has(img.rounded-full),
[data-melt-dropdown-menu-trigger]:has(img.rounded-full),
button[aria-label*="User"],
button[aria-label*="user"] { display: none !important; }
</style>
`;

function rewriteOpenWebUiHtml(html: string) {
  let result = html
    .replace(/(["'])\/_app\//g, `$1${OPEN_WEBUI_BASE_PATH}/_app/`)
    .replace(/(["'])\/static\//g, `$1${OPEN_WEBUI_BASE_PATH}/static/`)
    .replace(/(["'])\/manifest\.json/g, `$1${OPEN_WEBUI_BASE_PATH}/manifest.json`)
    .replace(/\bbase:\s*""/g, `base: "${OPEN_WEBUI_BASE_PATH}"`);

  if (result.includes('</head>')) {
    result = result.replace('</head>', `${OPEN_WEBUI_INJECT_STYLE}</head>`);
  } else if (result.includes('<body')) {
    result = result.replace('<body', `${OPEN_WEBUI_INJECT_STYLE}<body`);
  } else {
    result = OPEN_WEBUI_INJECT_STYLE + result;
  }

  return result;
}

function rewriteOpenWebUiLocationHeader(location: string, target: string) {
  if (!location || location.startsWith(OPEN_WEBUI_BASE_PATH)) {
    return location;
  }

  if (location.startsWith('/')) {
    return `${OPEN_WEBUI_BASE_PATH}${location}`;
  }

  try {
    const locationUrl = new URL(location);
    const targetUrl = new URL(target);
    const validOrigins = new Set([targetUrl.origin]);

    if (targetUrl.hostname === '127.0.0.1') {
      validOrigins.add(`${targetUrl.protocol}//localhost:${targetUrl.port}`);
    }

    if (targetUrl.hostname === 'localhost') {
      validOrigins.add(`${targetUrl.protocol}//127.0.0.1:${targetUrl.port}`);
    }

    if (validOrigins.has(locationUrl.origin)) {
      if (
        locationUrl.pathname === OPEN_WEBUI_BASE_PATH ||
        locationUrl.pathname.startsWith(`${OPEN_WEBUI_BASE_PATH}/`)
      ) {
        return `${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`;
      }

      return `${OPEN_WEBUI_BASE_PATH}${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`;
    }
  } catch {
    return location;
  }

  return location;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiProxyTarget = env.VITE_CORE_API_PROXY_TARGET || 'http://127.0.0.1:4100';
  const openWebUiProxyTarget = env.VITE_OPEN_WEBUI_PROXY_TARGET || 'http://127.0.0.1:8080';
  // Canvas backend is in core-api. No separate server needed.
  const canvasApiProxyTarget = env.VITE_CANVAS_API_PROXY_TARGET || env.VITE_TWITCANVA_API_PROXY_TARGET || apiProxyTarget;

  return {
    plugins: [react(), tailwindcss(), openWebUiModelsPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // Canvas source (merged from internal/twitcanva-source/src into src/canvas/)
        '@canvas': path.resolve(__dirname, 'src/canvas'),
      },
    },
    server: {
      host: '::',
      allowedHosts: true,
      cors: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/uploads': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        [OPEN_WEBUI_BASE_PATH]: {
          target: openWebUiProxyTarget,
          changeOrigin: true,
          ws: true,
          selfHandleResponse: true,
          rewrite: (requestPath) => rewriteOpenWebUiRequestPath(requestPath),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const url = req.url || '';
              const isStaticAsset = /\.(?:js|css|json|png|jpe?g|gif|svg|ico|woff2?|ttf|map|webmanifest)(?:\?|$)/.test(url);
              if (!isStaticAsset) {
                proxyReq.setHeader('accept-encoding', 'identity');
              }
            });

            proxy.on('proxyRes', (proxyRes, req, response) => {
              const headers = { ...proxyRes.headers } as Record<string, string | string[] | undefined>;
              const locationHeader = proxyRes.headers.location as
                | string
                | string[]
                | undefined;

              if (typeof locationHeader === 'string') {
                headers.location = rewriteOpenWebUiLocationHeader(
                  locationHeader,
                  openWebUiProxyTarget,
                );
              }

              if (Array.isArray(locationHeader) && locationHeader.length > 0) {
                headers.location = rewriteOpenWebUiLocationHeader(
                  String(locationHeader[0]),
                  openWebUiProxyTarget,
                );
              }

              const contentType = String(proxyRes.headers['content-type'] || '');
              const statusCode = proxyRes.statusCode || 200;

              if (!contentType.includes('text/html')) {
                const url = req.url || '';
                const isImmutable = /\/_app\/|\/static\/.*\.[0-9a-f]{8,}/.test(url);
                if (isImmutable && !headers['cache-control']) {
                  headers['cache-control'] = 'public, max-age=604800, immutable';
                }
                response.writeHead(statusCode, headers as Record<string, string>);
                proxyRes.pipe(response);
                return;
              }

              delete headers['content-length'];
              delete headers['content-encoding'];

              const chunks: Buffer[] = [];
              proxyRes.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              });

              proxyRes.on('end', () => {
                const rewrittenHtml = rewriteOpenWebUiHtml(
                  Buffer.concat(chunks).toString('utf8'),
                );
                const body = Buffer.from(rewrittenHtml, 'utf8');
                headers['content-length'] = String(body.length);
                response.writeHead(statusCode, headers as Record<string, string>);
                response.end(body);
              });
            });
          },
        },
        // Canonical canvas library path — no rewrite needed, core-api serves it directly.
        '/canvas-library': {
          target: canvasApiProxyTarget,
          changeOrigin: true,
        },
        // Legacy aliases kept for pre-built dist compatibility.
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify-file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    preview: {
      host: '::',
      allowedHosts: true,
      cors: true,
    },
  };
});

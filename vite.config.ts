import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import solid from '@solidjs/vite-plugin';

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.from(String(chunk));
}

function requestPath(req: IncomingMessage): string {
  return (req.url ?? '/').split('?')[0] ?? '/';
}

function shouldBufferHtml(req: IncomingMessage): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = requestPath(req);
  if (path.startsWith('/@') || path.includes('.')) return false;
  const accept = req.headers.accept ?? '';
  return path === '/' || accept.includes('text/html');
}

/**
 * Solid start mode streams the document as `Transfer-Encoding: chunked`
 * with no Content-Length. Cursor's preview proxy fails that with
 * ERR_INVALID_HTTP_RESPONSE. Buffer HTML so the response is a normal
 * Content-Length body. Must be registered before `solid()`.
 */
function previewCompatibleHtml(): Plugin {
  return {
    name: 'preview-compatible-html',
    // Same bucket as `solid:ssr/setup` so this wrap sits in front of the
    // streamed HTML handler.
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (shouldBufferHtml(req)) {
          const accept = req.headers.accept ?? '';
          if (!accept.includes('text/html')) {
            req.headers.accept = accept ? `text/html,${accept}` : 'text/html';
          }

          const chunks: Buffer[] = [];
          const originalWrite = res.write.bind(res);
          const originalEnd = res.end.bind(res);

          res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
            const callback = typeof encoding === 'function' ? encoding : cb;
            if (chunk) chunks.push(toBuffer(chunk));
            if (typeof callback === 'function') (callback as () => void)();
            return true;
          }) as ServerResponse['write'];

          res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
            const callback =
              typeof encoding === 'function'
                ? encoding
                : typeof cb === 'function'
                  ? cb
                  : undefined;
            if (chunk && typeof chunk !== 'function') chunks.push(toBuffer(chunk));
            const body = Buffer.concat(chunks);
            res.write = originalWrite;
            res.end = originalEnd;
            res.removeHeader('transfer-encoding');
            res.setHeader('content-length', String(body.length));
            originalEnd(body, callback as () => void);
            return res;
          }) as ServerResponse['end'];
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // Turnkey client mode: no index.html and no mount file — the plugin
  // generates the entries around src/App.tsx, wrapped in src/Document.tsx
  // (or a built-in shell). `vite build` prerenders the shell into
  // dist/client/index.html and emits a purely static dist/client.
  plugins: [
    previewCompatibleHtml(),
    solid({
      start: {
        // Optional peer `@solidjs/start-devtools` is not installed; keep
        // the generated client entry from importing a missing DevToolbar.
        devtools: false,
      },
    }),
  ],
  server: {
    port: 3000,
    strictPort: true,
    // Bind IPv4 explicitly. `host: true` listens on :::3000 only, and
    // Cursor's port forward looks for 0.0.0.0:3000 — otherwise the
    // preview gets ERR_CONNECTION_REFUSED.
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    target: 'esnext',
    // Keep images as asset files instead of inlining them into the JS bundle.
    assetsInlineLimit: 0,
  },
});

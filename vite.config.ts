import { defineConfig, type Plugin } from 'vite';
import solid from '@solidjs/vite-plugin';

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  return new TextEncoder().encode(String(chunk));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function requestPath(url: string | undefined): string {
  return (url ?? '/').split('?')[0] ?? '/';
}

function shouldBufferHtml(req: object): boolean {
  const method = Reflect.get(req, 'method');
  if (method !== 'GET' && method !== 'HEAD') return false;
  const url = Reflect.get(req, 'url');
  const path = requestPath(typeof url === 'string' ? url : undefined);
  if (path.startsWith('/@') || path.includes('.')) return false;
  const headers = Reflect.get(req, 'headers');
  if (typeof headers !== 'object' || headers === null) return false;
  const accept = Reflect.get(headers, 'accept');
  const acceptHeader = Array.isArray(accept)
    ? accept.join(',')
    : typeof accept === 'string'
      ? accept
      : '';
  return acceptHeader.includes('text/html');
}

/**
 * Solid start mode streams the document as `Transfer-Encoding: chunked`
 * with no Content-Length. Cursor's preview proxy fails that with
 * ERR_INVALID_HTTP_RESPONSE. Buffer HTML so the response is a normal
 * Content-Length body.
 */
function previewCompatibleHtml(): Plugin {
  return {
    name: 'preview-compatible-html',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!shouldBufferHtml(req)) {
          next();
          return;
        }

        const chunks: Uint8Array[] = [];
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);

        res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
          const callback = typeof encoding === 'function' ? encoding : cb;
          if (chunk) chunks.push(toBytes(chunk));
          if (typeof callback === 'function') (callback as () => void)();
          return true;
        }) as typeof res.write;

        res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
          const callback =
            typeof encoding === 'function'
              ? encoding
              : typeof cb === 'function'
                ? cb
                : undefined;
          if (chunk && typeof chunk !== 'function') chunks.push(toBytes(chunk));
          const body = concatBytes(chunks);
          res.write = originalWrite;
          res.end = originalEnd;
          res.removeHeader('transfer-encoding');
          res.setHeader('content-length', String(body.byteLength));
          originalEnd(body, callback as () => void);
          return res;
        }) as typeof res.end;

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
        // Optional peer `@solidjs/start-devtools` is not installed. Leaving
        // the default on makes the client import a stub with no DevToolbar
        // export, so the app never mounts.
        devtools: false,
      },
    }),
  ],
  server: {
    port: 3000,
    // IPv4 bind: `host: true` only listens on :::3000, and Cursor's
    // port forward looks for 0.0.0.0:3000.
    host: '0.0.0.0',
  },
  build: {
    target: 'esnext',
    // Keep images as asset files instead of inlining them into the JS bundle.
    assetsInlineLimit: 0,
  },
});

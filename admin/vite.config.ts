import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void;

const backend = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  base: '/admin/',
  plugins: [
    react(),
    {
      name: 'redirect-root-to-admin',
      configureServer(server) {
        const redirect: ConnectMiddleware = (req, res, next) => {
          const url = req.url?.split('?')[0] ?? '';
          if (url === '/' || url === '' || url === '/admin') {
            res.statusCode = 302;
            const q = req.url?.includes('?')
              ? req.url.substring(req.url.indexOf('?'))
              : '';
            res.setHeader('Location', '/admin/' + q);
            res.end();
            return;
          }
          next();
        };
        server.middlewares.use(redirect);
      },
    },
  ],
  server: {
    port: 5173,
    open: '/admin/',
    proxy: {
      '/health': { target: backend, changeOrigin: true },
      '/jobs': {
        target: backend,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/admin': { target: backend, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
    },
  },
});

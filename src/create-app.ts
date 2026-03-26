import express, { type Express } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { httpLogger, requestIdMiddleware } from './middleware/request-log.js';
import { jobsRouter } from './api/jobs.routes.js';
import { adminRouter } from './api/admin.routes.js';
import {
  adminAuthMiddleware,
  getAdminApiToken,
} from './middleware/admin-auth.js';

function adminDistPath(): string {
  // cwd is project root for `npm run dev` / `npm start`
  return path.resolve(process.cwd(), 'admin', 'dist');
}

function adminHelpHtml(title: string, bodyInner: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head>
<body style="font-family: system-ui; max-width: 42rem; margin: 2rem; line-height: 1.5;">
  <h1>${title}</h1>
  ${bodyInner}
  <p style="margin-top:2rem;"><a href="/">← API</a> · <a href="/health">/health</a></p>
</body>
</html>`;
}

export function createApp(): Express {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(httpLogger);
  app.use(express.json({ limit: '2mb' }));

  const adminToken = getAdminApiToken();
  const adminEnabled = Boolean(adminToken);
  const adminIndex = adminDistPath();
  const adminBuilt = fs.existsSync(path.join(adminIndex, 'index.html'));

  app.get('/', (_req, res) => {
    if (adminEnabled && adminBuilt) {
      res.redirect(302, '/admin/');
      return;
    }
    res.type('html').send(`<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"/><title>Cinematic Video Maker</title></head>
<body style="font-family: system-ui; max-width: 40rem; margin: 2rem;">
  <h1>Điện ảnh hóa kiến thức — API</h1>
  <p>Orchestrator B-roll + voiceover + preset JSON. <a href="/admin/">Admin</a> — cần <code>ADMIN_API_TOKEN</code> + <code>npm run admin:build</code> (xem trang <code>/admin/</code>).</p>
  <ul>
    <li><a href="/health">GET /health</a></li>
    <li><code>POST /jobs/render</code> — OpenAI (idea) hoặc scenes → ElevenLabs → B-roll → FFmpeg → ASS/BGM/SFX</li>
    <li><code>POST /jobs/render/from-video</code> — reuse audio + alignment; tuỳ chọn ingest B-roll lại hoặc assemble-only</li>
  </ul>
</body>
</html>`);
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'cinematic-video-maker' });
  });

  app.use('/jobs', jobsRouter);

  if (!adminEnabled) {
    app.use('/admin/api', (_req, res) => {
      res.status(503).json({
        ok: false,
        error:
          'Admin API tắt: đặt ADMIN_API_TOKEN trong .env rồi khởi động lại server.',
      });
    });
    app.get(/^\/admin(\/.*)?$/, (_req, res) => {
      res
        .status(200)
        .type('html')
        .send(
          adminHelpHtml(
            'Video Maker — Admin chưa bật',
            `<p>Trang SPA chạy tại <code>/admin/</code> khi bạn:</p>
<ol>
  <li>Thêm vào <code>.env</code>: <code>ADMIN_API_TOKEN=</code> một chuỗi bí mật (ví dụ random 32 ký tự).</li>
  <li>Build UI: <code>npm run admin:build</code> (hoặc <code>npm run build</code>).</li>
  <li>Khởi động lại backend: <code>npm run dev</code> hoặc <code>npm start</code>.</li>
  <li>Mở lại <a href="/admin/"><code>/admin/</code></a> — dán token vào ô trên giao diện và bấm Lưu.</li>
</ol>
<p>Dev song song: terminal 1 <code>npm run dev</code>, terminal 2 <code>npm run admin</code> (Vite proxy cổng 5173 cũng được).</p>`,
          ),
        );
    });
    return app;
  }

  app.use('/admin/api', adminAuthMiddleware, adminRouter);

  if (!adminBuilt) {
    app.get(/^\/admin(\/.*)?$/, (_req, res) => {
      res
        .status(503)
        .type('html')
        .send(
          adminHelpHtml(
            'Video Maker — Chưa build admin UI',
            `<p><code>ADMIN_API_TOKEN</code> đã có nhưng thiếu thư mục <code>admin/dist/</code>.</p>
<p>Chạy từ root repo:</p>
<pre style="background:#f5f5f5;padding:1rem;">npm run admin:build</pre>
<p>Hoặc <code>npm run build</code> (gồm cả admin + TypeScript). Sau đó khởi động lại server và tải lại <a href="/admin/"><code>/admin/</code></a>.</p>`,
          ),
        );
    });
    return app;
  }

  // Không dùng app.get('/admin') redirect: với strict routing mặc định, route đó
  // cũng khớp /admin/ → vòng lặp 302 về chính nó.

  app.use('/admin', express.static(adminIndex, { index: false }));
  app.get(/^\/admin(\/.*)?$/, (_req, res) => {
    res.sendFile(path.resolve(adminIndex, 'index.html'));
  });

  return app;
}

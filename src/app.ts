import 'dotenv/config';
import './instrumentation.js';
import express from 'express';
import { httpLogger, requestIdMiddleware } from './middleware/request-log.js';
import { jobsRouter } from './api/jobs.routes.js';
import { shutdownLangfuseOtel } from './instrumentation.js';
import { logger } from './shared/logger.js';

const app = express();
app.use(requestIdMiddleware);
app.use(httpLogger);
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"/><title>Ma Chủ Video Maker</title></head>
<body style="font-family: system-ui; max-width: 40rem; margin: 2rem;">
  <h1>Ma Chủ — AI Content Factory (API)</h1>
  <p>Đây là backend orchestrator, không có giao diện web. Dùng n8n hoặc HTTP client.</p>
  <ul>
    <li><a href="/health">GET /health</a> — kiểm tra sống</li>
    <li><code>POST /jobs/render</code> — full flow: (OpenAI nếu gửi <code>idea</code>) hoặc <code>scenes</code> sẵn → ElevenLabs → Comfy → cắt cảnh → final</li>
    <li><code>POST /jobs/render/from-video</code> — chỉ từ Comfy/FFmpeg: tái dùng <code>meta.json</code>, <code>voice.mp3</code>, <code>scene-*.mp3</code> + file alignment (sau một lần <code>/render</code> đầy đủ). Body: <code>{ "jobId", "bgmPath?", "reuseRawVideo?" }</code></li>
  </ul>
</body>
</html>`);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ma-chu-video-maker' });
});

app.use('/jobs', jobsRouter);

const port = Number(process.env.PORT ?? '3000');
const server = app.listen(port, () => {
  logger.info({ port }, 'listening');
});

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutdown');
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await shutdownLangfuseOtel().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

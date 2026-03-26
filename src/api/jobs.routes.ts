import { Router } from 'express';
import { z } from 'zod';
import {
  runContentPipeline,
  runVideoPhaseFromExistingAssets,
} from '../services/pipeline.service.js';
import { scriptSceneSchema } from '../types/script-schema.js';
import { renderTuningSchema } from '../types/render-preset-schema.js';
import { runWithLogContext } from '../shared/log-context.js';

export const jobsRenderBodySchema = z
  .object({
    jobId: z.string().min(1).max(200),
    idea: z.string().min(1).max(8000).optional(),
    scenes: z.array(scriptSceneSchema).min(1).optional(),
    bgmPath: z.string().optional(),
    profileId: z.string().min(1).max(120).optional(),
    tuning: renderTuningSchema.optional(),
    /** Đọc script từ meta.json có sẵn, chạy lại từ ElevenLabs → cuối pipeline. */
    resumeFrom: z.enum(['tts']).optional(),
  })
  .refine(
    (d) =>
      d.resumeFrom === 'tts' ||
      Boolean(d.idea?.trim()) ||
      Boolean(d.scenes?.length),
    {
      message:
        'Cần idea hoặc scenes, trừ khi resumeFrom: "tts" (meta.json đã có script).',
      path: ['idea'],
    },
  );

export const jobsRenderFromVideoBodySchema = z.object({
  jobId: z.string().min(1).max(200),
  bgmPath: z.string().optional(),
  reuseRawVideo: z.boolean().optional(),
  assembleOnly: z.boolean().optional(),
  profileId: z.string().min(1).max(120).optional(),
  tuning: renderTuningSchema.optional(),
});

export const jobsRouter = Router();

jobsRouter.post('/render', async (req, res) => {
  const parsed = jobsRenderBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const body = parsed.data;
  try {
    const result = await runWithLogContext(
      { requestId: String(req.id), jobId: body.jobId },
      () => runContentPipeline(body),
    );
    res.json({
      ok: true,
      finalVideoPath: result.finalVideoPath,
      meta: result.meta,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    req.log.error(
      { err: e, jobId: body.jobId, requestId: String(req.id) },
      'jobs.render failed',
    );
    res.status(500).json({ ok: false, error: msg });
  }
});

jobsRouter.post('/render/from-video', async (req, res) => {
  const parsed = jobsRenderFromVideoBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const body = parsed.data;
  try {
    const result = await runWithLogContext(
      { requestId: String(req.id), jobId: body.jobId },
      () => runVideoPhaseFromExistingAssets(body),
    );
    res.json({
      ok: true,
      finalVideoPath: result.finalVideoPath,
      meta: result.meta,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Job meta not found/i.test(msg)) {
      req.log.warn(
        { err: e, jobId: body.jobId, requestId: String(req.id), httpStatus: 404 },
        'jobs.from_video not found',
      );
      res.status(404).json({ ok: false, error: msg });
      return;
    }
    if (
      /Missing scene alignment|Missing scene audio|Invalid meta|Missing full voice|reuseRawVideo: missing|assembleOnly: missing/i.test(
        msg,
      )
    ) {
      req.log.warn(
        { err: e, jobId: body.jobId, requestId: String(req.id), httpStatus: 400 },
        'jobs.from_video bad request',
      );
      res.status(400).json({ ok: false, error: msg });
      return;
    }
    req.log.error(
      { err: e, jobId: body.jobId, requestId: String(req.id) },
      'jobs.from_video failed',
    );
    res.status(500).json({ ok: false, error: msg });
  }
});

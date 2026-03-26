import { Router } from 'express';
import { z } from 'zod';
import {
  runContentPipeline,
  runVideoPhaseFromExistingAssets,
} from '../services/pipeline.service.js';
import { ComfyOutOfMemoryError, ComfyWorkflowError } from '../services/comfy.service.js';
import { scriptSceneSchema } from '../types/script-schema.js';
import {
  characterProfileV1Schema,
  environmentContextV1Schema,
} from '../types/character-profile-schema.js';
import { runWithLogContext } from '../shared/log-context.js';

export const jobsRenderBodySchema = z
  .object({
    jobId: z.string().min(1).max(200),
    idea: z.string().min(1).max(8000).optional(),
    scenes: z.array(scriptSceneSchema).min(1).optional(),
    bgmPath: z.string().optional(),
    characterProfile: characterProfileV1Schema.optional(),
    environment: environmentContextV1Schema.optional(),
    visual: z
      .object({
        chainComfyFrames: z.boolean().optional(),
        ipAdapterReferencePath: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (d) => Boolean(d.idea?.trim()) || Boolean(d.scenes?.length),
    {
      message:
        'Cần gửi idea (OpenAI) hoặc scenes (kịch bản sẵn, không gọi OpenAI).',
      path: ['idea'],
    },
  );

const renderFromVideoBody = z.object({
  jobId: z.string().min(1).max(200),
  bgmPath: z.string().optional(),
  reuseRawVideo: z.boolean().optional(),
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
    if (e instanceof ComfyWorkflowError) {
      req.log.warn(
        { err: e, jobId: body.jobId, requestId: String(req.id), httpStatus: 502 },
        'jobs.render comfy workflow',
      );
      res.status(502).json({ ok: false, error: msg });
      return;
    }
    if (e instanceof ComfyOutOfMemoryError) {
      req.log.warn(
        { err: e, jobId: body.jobId, requestId: String(req.id), httpStatus: 503 },
        'jobs.render comfy oom',
      );
      res.status(503).json({ ok: false, error: msg });
      return;
    }
    req.log.error(
      { err: e, jobId: body.jobId, requestId: String(req.id) },
      'jobs.render failed',
    );
    res.status(500).json({ ok: false, error: msg });
  }
});

jobsRouter.post('/render/from-video', async (req, res) => {
  const parsed = renderFromVideoBody.safeParse(req.body);
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
      /Missing scene alignment|Missing scene audio|Invalid meta|Missing full voice|reuseRawVideo: missing/i.test(
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
    if (e instanceof ComfyWorkflowError) {
      req.log.warn(
        { err: e, jobId: body.jobId, requestId: String(req.id), httpStatus: 502 },
        'jobs.from_video comfy workflow',
      );
      res.status(502).json({ ok: false, error: msg });
      return;
    }
    if (e instanceof ComfyOutOfMemoryError) {
      req.log.warn(
        { err: e, jobId: body.jobId, requestId: String(req.id), httpStatus: 503 },
        'jobs.from_video comfy oom',
      );
      res.status(503).json({ ok: false, error: msg });
      return;
    }
    req.log.error(
      { err: e, jobId: body.jobId, requestId: String(req.id) },
      'jobs.from_video failed',
    );
    res.status(500).json({ ok: false, error: msg });
  }
});

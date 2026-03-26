import { Router } from 'express';
import { z } from 'zod';
import {
  runContentPipeline,
  runVideoPhaseFromExistingAssets,
} from '../services/pipeline.service.js';
import { ComfyOutOfMemoryError, ComfyWorkflowError } from '../services/comfy.service.js';
import { scriptSceneSchema } from '../types/script-schema.js';

const renderBody = z
  .object({
    jobId: z.string().min(1).max(200),
    idea: z.string().min(1).max(8000).optional(),
    scenes: z.array(scriptSceneSchema).min(1).optional(),
    bgmPath: z.string().optional(),
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
  const parsed = renderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await runContentPipeline(parsed.data);
    res.json({
      ok: true,
      finalVideoPath: result.finalVideoPath,
      meta: result.meta,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof ComfyWorkflowError) {
      res.status(502).json({ ok: false, error: msg });
      return;
    }
    if (e instanceof ComfyOutOfMemoryError) {
      res.status(503).json({ ok: false, error: msg });
      return;
    }
    console.error(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

jobsRouter.post('/render/from-video', async (req, res) => {
  const parsed = renderFromVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await runVideoPhaseFromExistingAssets(parsed.data);
    res.json({
      ok: true,
      finalVideoPath: result.finalVideoPath,
      meta: result.meta,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Job meta not found/i.test(msg)) {
      res.status(404).json({ ok: false, error: msg });
      return;
    }
    if (
      /Missing scene alignment|Missing scene audio|Invalid meta|Missing full voice|reuseRawVideo: missing/i.test(
        msg,
      )
    ) {
      res.status(400).json({ ok: false, error: msg });
      return;
    }
    if (e instanceof ComfyWorkflowError) {
      res.status(502).json({ ok: false, error: msg });
      return;
    }
    if (e instanceof ComfyOutOfMemoryError) {
      res.status(503).json({ ok: false, error: msg });
      return;
    }
    console.error(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

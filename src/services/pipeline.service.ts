import '../instrumentation.js';
import {
  propagateAttributes,
  startActiveObservation,
} from '@langfuse/tracing';

import fs from 'node:fs';
import path from 'node:path';
import {
  createPathProvider,
  type JobPaths,
  type PathProvider,
} from '../shared/path-provider.js';
import { ffprobeDurationSec } from '../shared/ffprobe.js';
import type { JobMeta } from '../types/job-meta.js';
import type { CharacterAlignment } from '../types/elevenlabs.js';
import { sceneAlignmentArtifactSchema } from '../types/scene-alignment-artifact.js';
import type { ScriptScene } from '../types/script-schema.js';
import { scriptScenesFullText } from '../types/script-schema.js';
import { scriptService } from './script.service.js';
import { voiceService } from './voice.service.js';
import { comfyService } from './comfy.service.js';
import { getLogContext } from '../shared/log-context.js';
import { logger } from '../shared/logger.js';
import { pipelineLog } from '../shared/pipeline-log.js';
import {
  assembleFinalVideoPremuxed,
  concatSceneClips,
  createSceneClip,
  generateColorBarsVideo,
  mergeSceneAlignments,
  sceneEmotionToFfmpegMotionLabel,
  type SceneAlignmentChunk,
} from './video.service.js';

function jobLifecycle(msg: string, fields: Record<string, unknown>): void {
  logger.info({ component: 'job', ...getLogContext(), ...fields }, msg);
}

export type RunJobInput = {
  jobId: string;
  /** Gọi OpenAI sinh kịch bản khi không có `scenes`. */
  idea?: string;
  /** Kịch bản gửi sẵn: bỏ OpenAI, vẫn chạy ElevenLabs + Comfy + FFmpeg. */
  scenes?: ScriptScene[];
  bgmPath?: string;
};

export type RunVideoPhaseInput = {
  jobId: string;
  bgmPath?: string;
  /** Skip Comfy and use existing `comfy/raw.mp4` */
  reuseRawVideo?: boolean;
};

export type RunJobResult = {
  meta: JobMeta;
  finalVideoPath: string;
};

async function writeMeta(
  paths: ReturnType<PathProvider['jobPaths']>,
  meta: JobMeta,
): Promise<void> {
  await fs.promises.mkdir(paths.jobRoot, { recursive: true });
  await fs.promises.writeFile(
    paths.metaFile,
    JSON.stringify(meta, null, 2),
    'utf8',
  );
}

function resolveBgm(
  provider: PathProvider,
  bgmPath?: string,
): string | undefined {
  let bgm: string | undefined;
  if (bgmPath) {
    bgm = path.isAbsolute(bgmPath)
      ? bgmPath
      : path.join(provider.dataRoot, bgmPath);
  } else if (process.env.BGM_PATH?.trim()) {
    const v = process.env.BGM_PATH.trim();
    bgm = path.isAbsolute(v) ? v : path.join(provider.dataRoot, v);
  }
  return bgm && fs.existsSync(bgm) ? bgm : undefined;
}

async function writeSceneAlignmentArtifact(
  paths: JobPaths,
  sceneId: number,
  alignment: CharacterAlignment,
  normalized?: CharacterAlignment,
): Promise<void> {
  await fs.promises.mkdir(paths.audioDir, { recursive: true });
  const payload = { alignment, normalizedAlignment: normalized };
  await fs.promises.writeFile(
    paths.sceneAlignmentJson(sceneId),
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

async function loadSceneAlignmentChunksFromDisk(
  paths: JobPaths,
  sortedScenes: { id: number }[],
): Promise<SceneAlignmentChunk[]> {
  const chunks: SceneAlignmentChunk[] = [];
  for (const s of sortedScenes) {
    const mp3 = paths.sceneVoiceMp3(s.id);
    const aj = paths.sceneAlignmentJson(s.id);
    if (!fs.existsSync(mp3)) {
      throw new Error(`Missing scene audio: ${mp3}`);
    }
    if (!fs.existsSync(aj)) {
      throw new Error(
        `Missing scene alignment file (run POST /jobs/render once for this jobId): ${aj}`,
      );
    }
    const raw: unknown = JSON.parse(await fs.promises.readFile(aj, 'utf8'));
    const art = sceneAlignmentArtifactSchema.parse(raw);
    let durationSec: number;
    try {
      durationSec = await ffprobeDurationSec(mp3);
    } catch {
      const ends = art.alignment.character_end_times_seconds;
      durationSec = ends.length > 0 ? Math.max(...ends) : 0;
    }
    chunks.push({
      alignment: art.alignment,
      normalizedAlignment: art.normalizedAlignment,
      durationSec,
    });
  }
  return chunks;
}

/** Comfy / placeholder: một lần render cho mỗi cảnh — driving theo `scene.emotion`. */
async function runComfyPerScenes(args: {
  paths: JobPaths;
  provider: PathProvider;
  meta: JobMeta;
  jobId: string;
  reuseRawVideo: boolean;
  sortedScenes: ScriptScene[];
}): Promise<void> {
  const { paths, provider, meta, jobId, reuseRawVideo, sortedScenes } = args;

  if (reuseRawVideo) {
    const perSceneOk = sortedScenes.every((s) =>
      fs.existsSync(paths.comfySceneRawVideo(s.id)),
    );
    if (!perSceneOk && !fs.existsSync(paths.comfyRawVideo)) {
      throw new Error(
        `reuseRawVideo: thiếu comfy/scenes/raw-scene-*.mp4 hoặc comfy/raw.mp4 (${paths.jobRoot})`,
      );
    }
    pipelineLog('comfy.skip', {
      reason: 'reuseRawVideo',
      jobId,
      perSceneFiles: perSceneOk,
      legacySingleRaw: !perSceneOk,
    });
    if (perSceneOk) {
      meta.comfy = {
        sceneRawById: Object.fromEntries(
          sortedScenes.map((s) => [
            String(s.id),
            paths.comfySceneRawVideo(s.id),
          ]),
        ),
        rawVideoPath: fs.existsSync(paths.comfyRawVideo)
          ? paths.comfyRawVideo
          : paths.comfySceneRawVideo(sortedScenes[0]!.id),
      };
    } else {
      meta.comfy = { rawVideoPath: paths.comfyRawVideo };
    }
    return;
  }

  const masterFace = provider.masterFace();
  await fs.promises.mkdir(paths.scenesDir, { recursive: true });

  if (process.env.SKIP_COMFY === '1') {
    pipelineLog('comfy.placeholder', {
      jobId,
      mode: 'per_scene',
      sceneCount: sortedScenes.length,
    });
    const sceneRawById: Record<string, string> = {};
    for (const scene of sortedScenes) {
      const out = paths.comfySceneRawVideo(scene.id);
      let dur = 30;
      try {
        dur =
          Math.ceil(await ffprobeDurationSec(paths.sceneVoiceMp3(scene.id))) +
          5;
      } catch {
        /* keep default */
      }
      await generateColorBarsVideo(out, 1080, 1920, Math.max(10, dur));
      sceneRawById[String(scene.id)] = out;
    }
    meta.comfy = { sceneRawById, rawVideoPath: paths.comfyRawVideo };
    if (sortedScenes[0]) {
      await fs.promises.copyFile(
        paths.comfySceneRawVideo(sortedScenes[0].id),
        paths.comfyRawVideo,
      );
    }
    return;
  }

  if (!fs.existsSync(masterFace)) {
    throw new Error(
      `Master face missing: ${masterFace} (place Master_Face.png under assets)`,
    );
  }

  const sceneRawById: Record<string, string> = {};
  for (const scene of sortedScenes) {
    const out = paths.comfySceneRawVideo(scene.id);
    const subJobId = `${jobId}-s${scene.id}`;
    pipelineLog('comfy.render.start', {
      jobId,
      sceneId: scene.id,
      subJobId,
      drivingEmotion: scene.emotion,
      note: 'LivePortrait một lần / cảnh — driving theo emotion cảnh này.',
    });
    await comfyService.renderVideo({
      jobId: subJobId,
      masterFacePath: masterFace,
      voiceAudioPath: paths.sceneVoiceMp3(scene.id),
      rawVideoOutPath: out,
      drivingEmotion: scene.emotion,
    });
    sceneRawById[String(scene.id)] = out;
    pipelineLog('comfy.render.scene_done', {
      jobId,
      sceneId: scene.id,
      rawRel: path.relative(paths.jobRoot, out),
    });
  }

  meta.comfy = { sceneRawById, rawVideoPath: paths.comfyRawVideo };
  if (sortedScenes[0]) {
    await fs.promises.copyFile(
      paths.comfySceneRawVideo(sortedScenes[0].id),
      paths.comfyRawVideo,
    );
  }
  pipelineLog('comfy.render.done', {
    jobId,
    perScene: true,
    sceneCount: sortedScenes.length,
    rawVideoPathLegacyMirror: paths.comfyRawVideo,
  });
}

async function assembleMultiSceneFromChunks(
  paths: JobPaths,
  provider: PathProvider,
  sortedScenes: ScriptScene[],
  sceneChunks: SceneAlignmentChunk[],
  bgmPath?: string,
): Promise<void> {
  await fs.promises.mkdir(paths.scenesDir, { recursive: true });
  pipelineLog('assemble.scenes', {
    count: sortedScenes.length,
    perScene: sortedScenes.map((s) => ({
      id: s.id,
      emotion: s.emotion,
      ffmpegMotion: sceneEmotionToFfmpegMotionLabel(s.emotion),
    })),
  });

  const rawVideoForScene = (sceneId: number): string => {
    const per = paths.comfySceneRawVideo(sceneId);
    if (fs.existsSync(per)) return per;
    if (fs.existsSync(paths.comfyRawVideo)) return paths.comfyRawVideo;
    throw new Error(
      `Thiếu video Comfy cho cảnh ${sceneId}: ${per} (hoặc legacy ${paths.comfyRawVideo})`,
    );
  };

  for (const scene of sortedScenes) {
    await createSceneClip({
      rawVideoPath: rawVideoForScene(scene.id),
      sceneAudioPath: paths.sceneVoiceMp3(scene.id),
      emotion: scene.emotion,
      outputPath: paths.sceneClipMp4(scene.id),
    });
  }

  const clipPaths = sortedScenes.map((s) => paths.sceneClipMp4(s.id));
  await concatSceneClips(clipPaths, paths.scenesConcatList, paths.scenesConcatMp4);

  const { alignment, normalizedAlignment } = mergeSceneAlignments(sceneChunks);
  const stitchedDuration = sceneChunks.reduce((s, c) => s + c.durationSec, 0);
  const bgm = resolveBgm(provider, bgmPath);
  pipelineLog('assemble.bgm', {
    resolved: Boolean(bgm),
    bgmPathRelative: bgm
      ? path.relative(provider.dataRoot, bgm)
      : undefined,
    bgmArgProvided: Boolean(bgmPath?.trim()),
    bgmEnvFallback: Boolean(process.env.BGM_PATH?.trim()),
  });

  await assembleFinalVideoPremuxed({
    paths,
    videoWithAudioPath: paths.scenesConcatMp4,
    alignment,
    normalizedAlignment,
    actualDurationSec: stitchedDuration,
    bgmPath: bgm,
  });
}

async function runContentPipelineInner(input: RunJobInput): Promise<RunJobResult> {
  const provider = createPathProvider();
  const paths = provider.jobPaths(input.jobId);

  const meta: JobMeta = {
    jobId: input.jobId,
    idea:
      input.idea?.trim() ||
      (input.scenes?.length ? 'Preset scenes (no OpenAI)' : ''),
    script: { scenes: [] },
  };

  await fs.promises.mkdir(paths.jobRoot, { recursive: true });
  const t0 = Date.now();
  jobLifecycle('job.start', {
    event: 'start',
    pipeline: 'content',
    jobId: input.jobId,
    scriptSource: input.scenes?.length ? 'preset_body' : 'openai',
    ideaLength: input.idea?.trim()?.length ?? 0,
    presetSceneCount: input.scenes?.length ?? 0,
  });

  const cps = Number(process.env.CHARS_PER_SECOND ?? '14');
  let sortedScenes: ScriptScene[];
  let durationEstimate: number;

  if (input.scenes && input.scenes.length > 0) {
    sortedScenes = [...input.scenes].sort((a, b) => a.id - b.id);
    const joined = scriptScenesFullText(sortedScenes);
    durationEstimate = Math.max(1, joined.length / cps);
  } else if (input.idea?.trim()) {
    const script = await scriptService.generateScript(input.idea, {
      sessionId: input.jobId,
    });
    sortedScenes = [...script.scenes].sort((a, b) => a.id - b.id);
    durationEstimate =
      script.duration_estimate ??
      Math.max(1, scriptScenesFullText(sortedScenes).length / cps);
  } else {
    throw new Error('Either idea or scenes is required');
  }

  const fullText = scriptScenesFullText(sortedScenes);

  meta.script = {
    scenes: sortedScenes,
    duration_estimate: durationEstimate,
  };
  await writeMeta(paths, meta);

  pipelineLog('script.resolved', {
    jobId: input.jobId,
    source: input.scenes?.length ? 'preset_body' : 'openai',
    sceneCount: sortedScenes.length,
    hookSceneId: sortedScenes[0]?.id,
    hookEmotion: sortedScenes[0]?.emotion,
    comfyDrivingPerScene: true,
    scenes: sortedScenes.map((s) => ({
      id: s.id,
      emotion: s.emotion,
      ffmpegMotion: sceneEmotionToFfmpegMotionLabel(s.emotion),
      chars: s.text.length,
    })),
  });

  pipelineLog('tts.full_voice.start', {
    jobId: input.jobId,
    charCount: fullText.length,
    outPath: paths.audioVoice,
  });
  const voiceFull = await voiceService.synthesizeWithTimestamps(
    fullText,
    paths.audioVoice,
    { kind: 'full' },
  );
  meta.script.actual_duration = voiceFull.actualDurationSec;
  meta.voice = {
    audioPath: voiceFull.audioPath,
    actualDurationSec: voiceFull.actualDurationSec,
    hasNormalizedAlignment: Boolean(voiceFull.normalizedAlignment),
  };
  await writeMeta(paths, meta);

  pipelineLog('tts.full_voice.done', {
    jobId: input.jobId,
    actualDurationSec: voiceFull.actualDurationSec,
    audioPath: paths.audioVoice,
  });

  const sceneChunks: SceneAlignmentChunk[] = [];
  for (const scene of sortedScenes) {
    pipelineLog('tts.scene.start', {
      jobId: input.jobId,
      sceneId: scene.id,
      emotion: scene.emotion,
      outMp3: paths.sceneVoiceMp3(scene.id),
    });
    const v = await voiceService.synthesizeWithTimestamps(
      scene.text,
      paths.sceneVoiceMp3(scene.id),
      { kind: 'scene', sceneId: scene.id },
    );
    sceneChunks.push({
      alignment: v.alignment,
      normalizedAlignment: v.normalizedAlignment,
      durationSec: v.actualDurationSec,
    });
    await writeSceneAlignmentArtifact(
      paths,
      scene.id,
      v.alignment,
      v.normalizedAlignment,
    );
    pipelineLog('tts.scene.done', {
      jobId: input.jobId,
      sceneId: scene.id,
      durationSec: v.actualDurationSec,
    });
  }

  await runComfyPerScenes({
    paths,
    provider,
    meta,
    jobId: input.jobId,
    reuseRawVideo: false,
    sortedScenes,
  });
  await writeMeta(paths, meta);

  await assembleMultiSceneFromChunks(
    paths,
    provider,
    sortedScenes,
    sceneChunks,
    input.bgmPath,
  );

  pipelineLog('pipeline.done', {
    jobId: input.jobId,
    finalVideoPath: paths.finalOutput,
  });

  jobLifecycle('job.complete', {
    event: 'complete',
    pipeline: 'content',
    jobId: input.jobId,
    durationMs: Date.now() - t0,
    finalVideoPath: paths.finalOutput,
  });

  return { meta, finalVideoPath: paths.finalOutput };
}

export async function runContentPipeline(
  input: RunJobInput,
): Promise<RunJobResult> {
  return startActiveObservation('pipeline.content', async () =>
    propagateAttributes(
      {
        sessionId: input.jobId.slice(0, 200),
        userId: input.jobId.slice(0, 200),
        traceName: 'video_render',
        metadata: {
          jobId: input.jobId.slice(0, 200),
          source: (input.scenes?.length ? 'preset_body' : 'openai').slice(0, 200),
        },
      },
      async () => runContentPipelineInner(input),
    ),
  );
}

/**
 * Continue from Comfy + multi-scene FFmpeg: uses existing `meta.json`,
 * `audio/voice.mp3`, `audio/scene-*.mp3`, and `audio/scene-*.alignment.json`
 * (alignment files are written on the first full `runContentPipeline` run).
 */
async function runVideoPhaseFromExistingAssetsInner(
  input: RunVideoPhaseInput,
): Promise<RunJobResult> {
  const provider = createPathProvider();
  const paths = provider.jobPaths(input.jobId);

  if (!fs.existsSync(paths.metaFile)) {
    throw new Error(`Job meta not found: ${paths.metaFile}`);
  }
  const rawMeta: unknown = JSON.parse(
    await fs.promises.readFile(paths.metaFile, 'utf8'),
  );
  const meta = rawMeta as JobMeta;
  if (!meta.script?.scenes?.length) {
    throw new Error(`Invalid meta: script.scenes missing (${paths.metaFile})`);
  }
  if (!fs.existsSync(paths.audioVoice)) {
    throw new Error(`Missing full voice track (Comfy driver): ${paths.audioVoice}`);
  }

  const t0 = Date.now();
  jobLifecycle('job.start', {
    event: 'start',
    pipeline: 'from_video',
    jobId: input.jobId,
    reuseRawVideo: Boolean(input.reuseRawVideo),
    bgmPathRequested: Boolean(input.bgmPath?.trim()),
  });

  const sortedScenes = [...meta.script.scenes].sort((a, b) => a.id - b.id);
  const sceneChunks = await loadSceneAlignmentChunksFromDisk(paths, sortedScenes);

  pipelineLog('from_video.assets', {
    jobId: input.jobId,
    reuseRawVideo: Boolean(input.reuseRawVideo),
    hookEmotion: sortedScenes[0]?.emotion,
    sceneCount: sortedScenes.length,
    perScene: sortedScenes.map((s) => ({
      id: s.id,
      emotion: s.emotion,
      ffmpegMotion: sceneEmotionToFfmpegMotionLabel(s.emotion),
    })),
  });

  await runComfyPerScenes({
    paths,
    provider,
    meta,
    jobId: input.jobId,
    reuseRawVideo: Boolean(input.reuseRawVideo),
    sortedScenes,
  });
  await writeMeta(paths, meta);

  await assembleMultiSceneFromChunks(
    paths,
    provider,
    sortedScenes,
    sceneChunks,
    input.bgmPath,
  );

  jobLifecycle('job.complete', {
    event: 'complete',
    pipeline: 'from_video',
    jobId: input.jobId,
    durationMs: Date.now() - t0,
    finalVideoPath: paths.finalOutput,
  });

  return { meta, finalVideoPath: paths.finalOutput };
}

export async function runVideoPhaseFromExistingAssets(
  input: RunVideoPhaseInput,
): Promise<RunJobResult> {
  return startActiveObservation('pipeline.from_video', async () =>
    propagateAttributes(
      {
        sessionId: input.jobId.slice(0, 200),
        userId: input.jobId.slice(0, 200),
        traceName: 'video_render_from_video',
        metadata: {
          jobId: input.jobId.slice(0, 200),
          source: 'from_video',
        },
      },
      async () => runVideoPhaseFromExistingAssetsInner(input),
    ),
  );
}

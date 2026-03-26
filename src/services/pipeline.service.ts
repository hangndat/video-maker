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
import type { JobMeta } from '../types/job-meta.js';
import type { CharacterAlignment } from '../types/elevenlabs.js';
import { sceneAlignmentArtifactSchema } from '../types/scene-alignment-artifact.js';
import type { ScriptScene } from '../types/script-schema.js';
import {
  scriptScenesFullText,
  stripMarkdownBoldForTts,
} from '../types/script-schema.js';
import { scriptService } from './script.service.js';
import { voiceService } from './voice.service.js';
import {
  resolveRenderConfig,
  defaultProfileId,
  type EffectiveRenderConfig,
} from './render-config.js';
import { getLogContext } from '../shared/log-context.js';
import { logger } from '../shared/logger.js';
import { pipelineLog } from '../shared/pipeline-log.js';
import {
  assembleFinalVideoPremuxed,
  concatSceneClips,
  createBrollSceneClip,
  generateColorBarsVideo,
  generateSineMp3,
  mergeSceneAlignments,
  sceneMotionToLabel,
  type SceneAlignmentChunk,
  type SfxTimelineEntry,
} from './video.service.js';
import { ffprobeDurationSec } from '../shared/ffprobe.js';
import {
  notifyJobFinished,
  notifyJobStarted,
} from '../shared/jobs-manifest.js';

function jobLifecycle(msg: string, fields: Record<string, unknown>): void {
  logger.info({ component: 'job', ...getLogContext(), ...fields }, msg);
}

export type RunJobInput = {
  jobId: string;
  idea?: string;
  scenes?: ScriptScene[];
  bgmPath?: string;
  profileId?: string;
  tuning?: Record<string, unknown>;
  /** Đọc `meta.json` đã có `script.scenes`, bỏ script/OpenAI, chạy lại từ ElevenLabs. */
  resumeFrom?: 'tts';
};

export type RunVideoPhaseInput = {
  jobId: string;
  bgmPath?: string;
  /** Reuse existing media/scenes/source-*.mp4 (skip copy ingest) */
  reuseRawVideo?: boolean;
  assembleOnly?: boolean;
  profileId?: string;
  tuning?: Record<string, unknown>;
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

async function writeDeclarativeSnapshot(
  paths: JobPaths,
  meta: JobMeta,
  effective: EffectiveRenderConfig,
): Promise<void> {
  const sorted = [...meta.script.scenes].sort((a, b) => a.id - b.id);
  const payload = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    jobId: meta.jobId,
    profileId: meta.profileId ?? effective.profileId,
    effectiveRenderConfig: effective,
    scenes: sorted.map((s) => ({
      id: s.id,
      motion: s.motion,
      videoPath: s.videoPath ?? null,
    })),
  };
  await fs.promises.mkdir(paths.declarativeDir, { recursive: true });
  await fs.promises.writeFile(
    paths.declarativeSnapshot,
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

function resolveDataPath(dataRoot: string, relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(dataRoot, relOrAbs);
}

async function ensureAssetMp4(
  absPath: string,
  placeholder: boolean,
): Promise<void> {
  if (fs.existsSync(absPath)) return;
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
  if (placeholder) {
    await generateColorBarsVideo(absPath, 1080, 1920, 12);
    pipelineLog('assets.placeholder_video', { path: absPath });
  }
}

async function ensureSfxPlaceholders(
  dataRoot: string,
  sfxMap: Record<string, string>,
): Promise<void> {
  for (const rel of Object.values(sfxMap)) {
    const p = resolveDataPath(dataRoot, rel);
    if (fs.existsSync(p)) continue;
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await generateSineMp3(p, 0.25, 880);
    pipelineLog('assets.placeholder_sfx', { path: p });
  }
}

function resolveBgmPath(
  provider: PathProvider,
  effective: EffectiveRenderConfig,
  bgmPathArg?: string,
): string | undefined {
  let rel: string | undefined;
  if (bgmPathArg?.trim()) rel = bgmPathArg.trim();
  else if (effective.audio.bgmRelativePath?.trim()) {
    rel = effective.audio.bgmRelativePath.trim();
  } else if (process.env.BGM_PATH?.trim()) {
    const v = process.env.BGM_PATH.trim();
    rel = path.isAbsolute(v) ? undefined : v;
    if (path.isAbsolute(v) && fs.existsSync(v)) return v;
  }
  if (!rel) return undefined;
  const full = resolveDataPath(provider.dataRoot, rel);
  return fs.existsSync(full) ? full : undefined;
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

async function ingestBrollSources(args: {
  paths: JobPaths;
  provider: PathProvider;
  sortedScenes: ScriptScene[];
  effective: EffectiveRenderConfig;
  reuseRawVideo: boolean;
  meta: JobMeta;
}): Promise<void> {
  const { paths, provider, sortedScenes, effective, reuseRawVideo, meta } =
    args;
  const ph =
    effective.video.placeholderRelativePath?.trim() ||
    'assets/broll/placeholder.mp4';
  const placeholderAbs = resolveDataPath(provider.dataRoot, ph);
  await ensureAssetMp4(placeholderAbs, true);
  await ensureSfxPlaceholders(provider.dataRoot, effective.audio.sfx);

  if (reuseRawVideo) {
    const ok = sortedScenes.every((s) =>
      fs.existsSync(paths.mediaSceneSource(s.id)),
    );
    if (!ok) {
      throw new Error(
        `reuseRawVideo: missing media/scenes/source-*.mp4 under ${paths.jobRoot}`,
      );
    }
    pipelineLog('media.skip_ingest', { reason: 'reuseRawVideo' });
    meta.media = {
      sceneSourceById: Object.fromEntries(
        sortedScenes.map((s) => [String(s.id), paths.mediaSceneSource(s.id)]),
      ),
    };
    return;
  }

  const sceneSourceById: Record<string, string> = {};
  for (const scene of sortedScenes) {
    const rel = scene.videoPath?.trim() || ph;
    const src = resolveDataPath(provider.dataRoot, rel);
    if (!fs.existsSync(src)) {
      throw new Error(`B-roll not found for scene ${scene.id}: ${src}`);
    }
    const dest = paths.mediaSceneSource(scene.id);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
    sceneSourceById[String(scene.id)] = dest;
    pipelineLog('media.ingest', {
      sceneId: scene.id,
      srcRel: path.relative(provider.dataRoot, src),
    });
  }
  meta.media = { sceneSourceById };

  if (sortedScenes[0]) {
    await fs.promises.copyFile(
      paths.mediaSceneSource(sortedScenes[0].id),
      paths.mediaRawVideo,
    );
  }
}

function buildSfxTimeline(args: {
  sortedScenes: ScriptScene[];
  sceneChunks: SceneAlignmentChunk[];
  effective: EffectiveRenderConfig;
  dataRoot: string;
}): SfxTimelineEntry[] {
  const { sortedScenes, sceneChunks, effective, dataRoot } = args;
  const sfxMap = effective.audio.sfx;
  const out: SfxTimelineEntry[] = [];
  const seen = new Set<string>();

  const push = (rel: string | undefined, offsetSec: number) => {
    if (!rel?.trim()) return;
    const filePath = resolveDataPath(dataRoot, rel.trim());
    if (!fs.existsSync(filePath)) return;
    const key = `${filePath}:${offsetSec.toFixed(3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ filePath, offsetSec });
  };

  push(sfxMap.hook, 0);

  let acc = 0;
  for (let i = 0; i < sortedScenes.length; i++) {
    const scene = sortedScenes[i]!;
    const chunk = sceneChunks[i];
    if (!chunk) break;
    if (i > 0) push(sfxMap.segment_start, acc);
    const sk = scene.sfxKey?.trim();
    if (sk && sfxMap[sk]) push(sfxMap[sk], acc);
    acc += chunk.durationSec;
  }
  return out;
}

function collectEmphasisWords(scenes: ScriptScene[]): string[] {
  const acc: string[] = [];
  for (const s of scenes) {
    for (const w of s.emphasisWords ?? []) {
      if (w.trim()) acc.push(w.trim());
    }
  }
  return acc;
}

async function assembleMultiSceneFromChunks(args: {
  paths: JobPaths;
  provider: PathProvider;
  sortedScenes: ScriptScene[];
  sceneChunks: SceneAlignmentChunk[];
  bgmPath?: string;
  effective: EffectiveRenderConfig;
}): Promise<void> {
  const {
    paths,
    provider,
    sortedScenes,
    sceneChunks,
    bgmPath,
    effective,
  } = args;

  await fs.promises.mkdir(paths.scenesDir, { recursive: true });
  pipelineLog('assemble.scenes', {
    count: sortedScenes.length,
    perScene: sortedScenes.map((s) => ({
      id: s.id,
      motion: sceneMotionToLabel(s.motion),
      videoMode: s.videoMode ?? effective.video.segmentVideoMode,
    })),
  });

  for (const scene of sortedScenes) {
    const src = paths.mediaSceneSource(scene.id);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing B-roll source for scene ${scene.id}: ${src}`);
    }
    const mode = scene.videoMode ?? effective.video.segmentVideoMode;
    await createBrollSceneClip({
      sourceVideoPath: src,
      sceneAudioPath: paths.sceneVoiceMp3(scene.id),
      motion: scene.motion ?? effective.motionDefault,
      segmentVideoMode: mode,
      outputPath: paths.sceneClipMp4(scene.id),
      fps: effective.video.outputFps,
    });
  }

  const clipPaths = sortedScenes.map((s) => paths.sceneClipMp4(s.id));
  await concatSceneClips(clipPaths, paths.scenesConcatList, paths.scenesConcatMp4);

  const stitchedDuration = sceneChunks.reduce((s, c) => s + c.durationSec, 0);
  await burnSubtitlesAndBgmOnConcat({
    paths,
    provider,
    sceneChunks,
    stitchedDuration,
    bgmPath,
    effective,
    sortedScenes,
  });
}

async function burnSubtitlesAndBgmOnConcat(args: {
  paths: JobPaths;
  provider: PathProvider;
  sceneChunks: SceneAlignmentChunk[];
  stitchedDuration: number;
  bgmPath?: string;
  effective: EffectiveRenderConfig;
  sortedScenes: ScriptScene[];
}): Promise<void> {
  const {
    paths,
    provider,
    sceneChunks,
    stitchedDuration,
    bgmPath,
    effective,
    sortedScenes,
  } = args;
  const { alignment, normalizedAlignment } = mergeSceneAlignments(sceneChunks);
  const bgm = resolveBgmPath(provider, effective, bgmPath);
  pipelineLog('assemble.bgm', {
    resolved: Boolean(bgm),
    mode: 'premuxed_concat',
  });

  const sfxTimeline = buildSfxTimeline({
    sortedScenes,
    sceneChunks,
    effective,
    dataRoot: provider.dataRoot,
  });

  await assembleFinalVideoPremuxed({
    paths,
    videoWithAudioPath: paths.scenesConcatMp4,
    alignment,
    normalizedAlignment,
    actualDurationSec: stitchedDuration,
    bgmPath: bgm,
    layout: {
      fontName: effective.ass.fontName,
      fontSize: effective.ass.fontSize,
      marginV: effective.ass.marginV,
      primaryAssColor: effective.ass.primaryColor,
      highlightAssColor: effective.ass.highlightColor,
    },
    emphasisWords: collectEmphasisWords(sortedScenes),
    sfxTimeline,
    audioDucking: effective.audio.ducking,
    bgmVolume: effective.audio.bgmVolume,
  });
}

async function runTtsAndWriteAlignments(
  paths: JobPaths,
  sortedScenes: ScriptScene[],
  effective: EffectiveRenderConfig,
  meta: JobMeta,
): Promise<SceneAlignmentChunk[]> {
  const fullText = scriptScenesFullText(sortedScenes);
  const elevenVoiceSettings = effective.elevenlabs.voice_settings;
  const ttsOptsFull = {
    kind: 'full' as const,
    voice_settings: elevenVoiceSettings,
  };

  pipelineLog('tts.full_voice.start', { charCount: fullText.length });
  const voiceFull = await voiceService.synthesizeWithTimestamps(
    fullText,
    paths.audioVoice,
    ttsOptsFull,
  );
  meta.script.actual_duration = voiceFull.actualDurationSec;
  meta.voice = {
    audioPath: voiceFull.audioPath,
    actualDurationSec: voiceFull.actualDurationSec,
    hasNormalizedAlignment: Boolean(voiceFull.normalizedAlignment),
  };
  await writeMeta(paths, meta);

  const sceneChunks: SceneAlignmentChunk[] = [];
  for (const scene of sortedScenes) {
    const ttsText = stripMarkdownBoldForTts(scene.text);
    const v = await voiceService.synthesizeWithTimestamps(
      ttsText,
      paths.sceneVoiceMp3(scene.id),
      {
        kind: 'scene',
        sceneId: scene.id,
        voice_settings: elevenVoiceSettings,
      },
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
  }
  return sceneChunks;
}

async function runContentPipelineFromTtsResume(
  input: RunJobInput,
): Promise<RunJobResult> {
  const provider = createPathProvider();
  const paths = provider.jobPaths(input.jobId);
  if (!fs.existsSync(paths.metaFile)) {
    throw new Error(
      `resumeFrom tts: chưa có meta.json — chạy render đầy đủ trước: ${paths.metaFile}`,
    );
  }
  const rawMeta: unknown = JSON.parse(
    await fs.promises.readFile(paths.metaFile, 'utf8'),
  );
  const loaded = rawMeta as JobMeta;
  if (!loaded.script?.scenes?.length) {
    throw new Error(
      'resumeFrom tts: meta.script.scenes trống — không thể TTS lại',
    );
  }

  const profileId =
    input.profileId?.trim() ||
    loaded.profileId?.trim() ||
    defaultProfileId();
  const effective = await resolveRenderConfig({
    dataRoot: provider.dataRoot,
    profileId,
    jobTuning: input.tuning,
  });

  const meta: JobMeta = {
    ...loaded,
    jobId: input.jobId,
    profileId: effective.profileId,
    presetPath: effective.presetPath,
    presetContentSha256: effective.presetContentSha256,
    effectiveRenderConfig: effective,
  };
  if (input.tuning) meta.tuning = input.tuning;

  await fs.promises.mkdir(paths.jobRoot, { recursive: true });
  const t0 = Date.now();
  jobLifecycle('job.start', {
    event: 'start',
    pipeline: 'content_tts_resume',
    jobId: input.jobId,
    profileId: effective.profileId,
  });

  const sortedScenes = [...meta.script.scenes].sort((a, b) => a.id - b.id);
  pipelineLog('pipeline.resume', { from: 'tts', sceneCount: sortedScenes.length });

  const sceneChunks = await runTtsAndWriteAlignments(
    paths,
    sortedScenes,
    effective,
    meta,
  );

  await writeDeclarativeSnapshot(paths, meta, effective);

  await ingestBrollSources({
    paths,
    provider,
    sortedScenes,
    effective,
    reuseRawVideo: false,
    meta,
  });
  await writeMeta(paths, meta);

  await assembleMultiSceneFromChunks({
    paths,
    provider,
    sortedScenes,
    sceneChunks,
    bgmPath: input.bgmPath,
    effective,
  });

  pipelineLog('pipeline.done', { jobId: input.jobId, resumeFrom: 'tts' });

  jobLifecycle('job.complete', {
    event: 'complete',
    pipeline: 'content_tts_resume',
    jobId: input.jobId,
    durationMs: Date.now() - t0,
    finalVideoPath: paths.finalOutput,
  });

  return { meta, finalVideoPath: paths.finalOutput };
}

async function runContentPipelineInner(input: RunJobInput): Promise<RunJobResult> {
  if (input.resumeFrom === 'tts') {
    return runContentPipelineFromTtsResume(input);
  }

  const provider = createPathProvider();
  const paths = provider.jobPaths(input.jobId);
  const profileId = input.profileId?.trim() || defaultProfileId();
  const effective = await resolveRenderConfig({
    dataRoot: provider.dataRoot,
    profileId,
    jobTuning: input.tuning,
  });

  const meta: JobMeta = {
    jobId: input.jobId,
    idea:
      input.idea?.trim() ||
      (input.scenes?.length ? 'Preset scenes (no OpenAI)' : ''),
    profileId: effective.profileId,
    presetPath: effective.presetPath,
    presetContentSha256: effective.presetContentSha256,
    effectiveRenderConfig: effective,
    tuning: input.tuning,
    script: { scenes: [] },
  };

  await fs.promises.mkdir(paths.jobRoot, { recursive: true });
  const t0 = Date.now();
  jobLifecycle('job.start', {
    event: 'start',
    pipeline: 'content',
    jobId: input.jobId,
    profileId,
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
      temperature: effective.openai.temperature,
      model: effective.openai.model,
    });
    sortedScenes = [...script.scenes].sort((a, b) => a.id - b.id);
    durationEstimate =
      script.duration_estimate ??
      Math.max(1, scriptScenesFullText(sortedScenes).length / cps);
  } else {
    throw new Error('Either idea or scenes is required');
  }

  meta.script = {
    scenes: sortedScenes,
    duration_estimate: durationEstimate,
  };
  await writeMeta(paths, meta);
  await writeDeclarativeSnapshot(paths, meta, effective);

  pipelineLog('script.resolved', {
    jobId: input.jobId,
    sceneCount: sortedScenes.length,
    profileId,
  });

  const sceneChunks = await runTtsAndWriteAlignments(
    paths,
    sortedScenes,
    effective,
    meta,
  );

  await ingestBrollSources({
    paths,
    provider,
    sortedScenes,
    effective,
    reuseRawVideo: false,
    meta,
  });
  await writeMeta(paths, meta);

  await assembleMultiSceneFromChunks({
    paths,
    provider,
    sortedScenes,
    sceneChunks,
    bgmPath: input.bgmPath,
    effective,
  });

  pipelineLog('pipeline.done', { jobId: input.jobId });

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
  const provider = createPathProvider();
  const isTtsResume = input.resumeFrom === 'tts';
  const ideaPreview = isTtsResume
    ? 'resume: tts (script từ meta)'
    : input.idea?.trim().slice(0, 120) ||
      (input.scenes?.length ? 'preset scenes' : undefined);
  await notifyJobStarted(provider.dataRoot, {
    jobId: input.jobId,
    pipeline: isTtsResume ? 'content_tts_resume' : 'content',
    profileId: input.profileId?.trim(),
    ideaPreview,
  });
  try {
    const result = await startActiveObservation('pipeline.content', async () =>
      propagateAttributes(
        {
          sessionId: input.jobId.slice(0, 200),
          userId: input.jobId.slice(0, 200),
          traceName: isTtsResume ? 'video_render_tts_resume' : 'video_render',
          metadata: {
            jobId: input.jobId.slice(0, 200),
            source: isTtsResume
              ? 'tts_resume'
              : (input.scenes?.length ? 'preset_body' : 'openai').slice(0, 200),
            resumeFrom: input.resumeFrom ?? '',
          },
        },
        async () => runContentPipelineInner(input),
      ),
    );
    await notifyJobFinished(provider.dataRoot, input.jobId, {
      ok: true,
      profileId: result.meta.profileId,
    });
    return result;
  } catch (e) {
    await notifyJobFinished(provider.dataRoot, input.jobId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

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
  const baseMeta = rawMeta as JobMeta;
  if (!baseMeta.script?.scenes?.length) {
    throw new Error(`Invalid meta: script.scenes missing (${paths.metaFile})`);
  }

  const profileId =
    input.profileId?.trim() ||
    baseMeta.profileId?.trim() ||
    defaultProfileId();
  const effective =
    baseMeta.effectiveRenderConfig &&
    !input.tuning &&
    !input.profileId?.trim()
      ? baseMeta.effectiveRenderConfig
      : await resolveRenderConfig({
          dataRoot: provider.dataRoot,
          profileId,
          jobTuning: input.tuning,
        });

  const meta: JobMeta = {
    ...baseMeta,
    profileId: effective.profileId,
    presetPath: effective.presetPath,
    presetContentSha256: effective.presetContentSha256,
    effectiveRenderConfig: effective,
  };
  if (input.tuning) meta.tuning = input.tuning;

  const assembleOnly = Boolean(input.assembleOnly);
  if (!assembleOnly && !fs.existsSync(paths.audioVoice)) {
    throw new Error(`Missing full voice track: ${paths.audioVoice}`);
  }

  const t0 = Date.now();
  jobLifecycle('job.start', {
    event: 'start',
    pipeline: assembleOnly ? 'assemble_only' : 'from_video',
    jobId: input.jobId,
  });

  const sortedScenes = [...meta.script.scenes].sort((a, b) => a.id - b.id);
  const sceneChunks = await loadSceneAlignmentChunksFromDisk(paths, sortedScenes);

  await writeDeclarativeSnapshot(paths, meta, effective);

  if (assembleOnly) {
    if (!fs.existsSync(paths.scenesConcatMp4)) {
      throw new Error(
        `assembleOnly: missing ${paths.scenesConcatMp4} — run full render first`,
      );
    }
    const stitchedDuration = sceneChunks.reduce((s, c) => s + c.durationSec, 0);
    await burnSubtitlesAndBgmOnConcat({
      paths,
      provider,
      sceneChunks,
      stitchedDuration,
      bgmPath: input.bgmPath,
      effective,
      sortedScenes,
    });
  } else {
    await ingestBrollSources({
      paths,
      provider,
      sortedScenes,
      effective,
      reuseRawVideo: Boolean(input.reuseRawVideo),
      meta,
    });
    await writeMeta(paths, meta);

    await assembleMultiSceneFromChunks({
      paths,
      provider,
      sortedScenes,
      sceneChunks,
      bgmPath: input.bgmPath,
      effective,
    });
  }

  jobLifecycle('job.complete', {
    event: 'complete',
    pipeline: assembleOnly ? 'assemble_only' : 'from_video',
    jobId: input.jobId,
    durationMs: Date.now() - t0,
    finalVideoPath: paths.finalOutput,
  });

  return { meta, finalVideoPath: paths.finalOutput };
}

export async function runVideoPhaseFromExistingAssets(
  input: RunVideoPhaseInput,
): Promise<RunJobResult> {
  const provider = createPathProvider();
  const pipeline = input.assembleOnly ? 'assemble_only' : 'from_video';
  await notifyJobStarted(provider.dataRoot, {
    jobId: input.jobId,
    pipeline,
    profileId: input.profileId?.trim(),
  });
  try {
    const result = await startActiveObservation('pipeline.from_video', async () =>
      propagateAttributes(
        {
          sessionId: input.jobId.slice(0, 200),
          userId: input.jobId.slice(0, 200),
          traceName: 'video_render_from_video',
          metadata: { jobId: input.jobId.slice(0, 200) },
        },
        async () => runVideoPhaseFromExistingAssetsInner(input),
      ),
    );
    await notifyJobFinished(provider.dataRoot, input.jobId, {
      ok: true,
      profileId: result.meta.profileId,
    });
    return result;
  } catch (e) {
    await notifyJobFinished(provider.dataRoot, input.jobId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

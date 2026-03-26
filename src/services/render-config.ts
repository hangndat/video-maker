import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipelineLog } from '../shared/pipeline-log.js';
import {
  renderPresetFileSchema,
  renderTuningSchema,
  type RenderPresetFile,
} from '../types/render-preset-schema.js';
import type { SceneMotion } from '../types/script-schema.js';

export type EffectiveRenderConfig = {
  schemaVersion: number;
  profileId: string;
  presetPath: string;
  presetContentSha256: string;
  ass: {
    fontName: string;
    fontSize: number;
    primaryColor: string;
    highlightColor: string;
    marginV: number;
  };
  video: {
    segmentVideoMode: 'freeze_last' | 'loop';
    outputFps: number;
    placeholderRelativePath?: string;
  };
  motionDefault: SceneMotion;
  audio: {
    bgmRelativePath?: string;
    bgmVolume: number;
    ducking: boolean;
    sfx: Record<string, string>;
  };
  openai: {
    temperature: number;
    model?: string;
  };
  elevenlabs: {
    voice_settings?: {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      use_speaker_boost?: boolean;
    };
  };
};

function defaultEffective(profileId: string, presetPath: string, hash: string): EffectiveRenderConfig {
  const pct = Number(process.env.TIKTOK_SAFE_BOTTOM_PCT ?? '0.15');
  return {
    schemaVersion: 1,
    profileId,
    presetPath,
    presetContentSha256: hash,
    ass: {
      fontName: process.env.ASS_FONT_NAME ?? 'Arial',
      fontSize: Number(process.env.ASS_FONT_SIZE ?? '72'),
      primaryColor: process.env.ASS_PRIMARY_COLOR ?? '&H00FFFFFF',
      highlightColor: process.env.ASS_HIGHLIGHT_COLOR ?? '&H0000BFFF',
      marginV: Math.round(1920 * pct),
    },
    video: {
      segmentVideoMode: (() => {
        const m = process.env.SEGMENT_VIDEO_MODE?.trim();
        return m === 'loop' ? 'loop' : 'freeze_last';
      })(),
      outputFps: Number(process.env.VIDEO_OUTPUT_FPS ?? '30'),
      placeholderRelativePath: process.env.DEFAULT_BROLL_PLACEHOLDER?.trim() || undefined,
    },
    motionDefault: 'zoom_mild',
    audio: {
      bgmRelativePath: process.env.BGM_PATH?.trim() || undefined,
      bgmVolume: Number(process.env.BGM_VOLUME ?? '0.2'),
      ducking: process.env.AUDIO_MIX_MODE === 'ducking',
      sfx: {},
    },
    openai: {
      temperature: Number(process.env.OPENAI_TEMPERATURE ?? '0.75'),
      model: process.env.OPENAI_MODEL,
    },
    elevenlabs: {},
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge b over a (b wins). */
export function deepMerge<T extends Record<string, unknown>>(
  a: T,
  b: Record<string, unknown>,
): T {
  const out = { ...a } as Record<string, unknown>;
  for (const [k, bv] of Object.entries(b)) {
    if (bv === undefined) continue;
    const av = out[k];
    if (isPlainObject(av) && isPlainObject(bv)) {
      out[k] = deepMerge(av as Record<string, unknown>, bv);
    } else {
      out[k] = bv;
    }
  }
  return out as T;
}

export async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.promises.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function resolvePresetPath(dataRoot: string, profileId: string): string {
  const safe = profileId.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe !== profileId) {
    throw new Error(`Invalid profileId: ${profileId}`);
  }
  return path.join(dataRoot, 'profiles', `${profileId}.json`);
}

export async function loadRenderPresetFile(
  dataRoot: string,
  profileId: string,
): Promise<{ path: string; preset: RenderPresetFile; sha256: string }> {
  const presetPath = resolvePresetPath(dataRoot, profileId);
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Preset not found: ${presetPath}`);
  }
  const raw: unknown = JSON.parse(await fs.promises.readFile(presetPath, 'utf8'));
  const preset = renderPresetFileSchema.parse(raw);
  const sha = await sha256File(presetPath);
  return { path: presetPath, preset, sha256: sha };
}

export type ResolveRenderConfigInput = {
  dataRoot: string;
  profileId: string;
  jobTuning?: unknown;
};

export async function resolveRenderConfig(
  input: ResolveRenderConfigInput,
): Promise<EffectiveRenderConfig> {
  const { path: presetPath, preset, sha256 } = await loadRenderPresetFile(
    input.dataRoot,
    input.profileId,
  );

  const base = defaultEffective(input.profileId, presetPath, sha256);

  const fromPreset: Partial<EffectiveRenderConfig> = {
    schemaVersion: preset.schemaVersion,
    ass: {
      ...base.ass,
      ...(preset.ass?.fontName != null ? { fontName: preset.ass.fontName } : {}),
      ...(preset.ass?.fontSize != null ? { fontSize: preset.ass.fontSize } : {}),
      ...(preset.ass?.primaryColor != null
        ? { primaryColor: preset.ass.primaryColor }
        : {}),
      ...(preset.ass?.highlightColor != null
        ? { highlightColor: preset.ass.highlightColor }
        : {}),
      ...(preset.ass?.marginV != null ? { marginV: preset.ass.marginV } : {}),
    },
    video: {
      ...base.video,
      ...(preset.videoDefault?.segmentVideoMode != null
        ? { segmentVideoMode: preset.videoDefault.segmentVideoMode }
        : {}),
      ...(preset.videoDefault?.outputFps != null
        ? { outputFps: preset.videoDefault.outputFps }
        : {}),
      ...(preset.videoDefault?.placeholderRelativePath != null
        ? { placeholderRelativePath: preset.videoDefault.placeholderRelativePath }
        : {}),
    },
    motionDefault: preset.motionDefault ?? base.motionDefault,
    audio: {
      ...base.audio,
      ...(preset.audio?.bgmRelativePath != null
        ? { bgmRelativePath: preset.audio.bgmRelativePath }
        : {}),
      ...(preset.audio?.bgmVolume != null
        ? { bgmVolume: preset.audio.bgmVolume }
        : {}),
      ...(preset.audio?.ducking != null ? { ducking: preset.audio.ducking } : {}),
      ...(preset.audio?.sfx != null
        ? { sfx: { ...base.audio.sfx, ...preset.audio.sfx } }
        : {}),
    },
    openai: {
      ...base.openai,
      ...(preset.openai?.temperature != null
        ? { temperature: preset.openai.temperature }
        : {}),
      ...(preset.openai?.model != null ? { model: preset.openai.model } : {}),
    },
    elevenlabs: {
      ...(preset.elevenlabs?.voice_settings != null
        ? { voice_settings: preset.elevenlabs.voice_settings }
        : base.elevenlabs),
    },
  };

  let merged = deepMerge(
    base as unknown as Record<string, unknown>,
    fromPreset as unknown as Record<string, unknown>,
  ) as unknown as EffectiveRenderConfig;

  if (input.jobTuning !== undefined && input.jobTuning !== null) {
    const tuning = renderTuningSchema.parse(
      input.jobTuning as Record<string, unknown>,
    );
    const tuningFlat = presetToEffectivePatch(tuning);
    merged = deepMerge(
      merged as unknown as Record<string, unknown>,
      tuningFlat as Record<string, unknown>,
    ) as EffectiveRenderConfig;
  }

  merged.profileId = input.profileId;
  merged.presetPath = presetPath;
  merged.presetContentSha256 = sha256;

  pipelineLog('config.resolved', {
    profileId: merged.profileId,
    segmentVideoMode: merged.video.segmentVideoMode,
    motionDefault: merged.motionDefault,
    assFont: merged.ass.fontName,
    bgmRelativePath: merged.audio.bgmRelativePath ?? null,
    openaiTemperature: merged.openai.temperature,
    presetSha256: merged.presetContentSha256.slice(0, 16),
  });

  return merged;
}

/** Flatten nested RenderTuning into EffectiveRenderConfig-shaped patch. */
function presetToEffectivePatch(t: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof t.schemaVersion === 'number') patch.schemaVersion = t.schemaVersion;
  if (isPlainObject(t.ass)) patch.ass = t.ass;
  if (t.motionDefault != null && typeof t.motionDefault === 'string') {
    patch.motionDefault = t.motionDefault;
  }
  if (isPlainObject(t.videoDefault)) patch.video = t.videoDefault;
  if (isPlainObject(t.audio)) patch.audio = t.audio;
  if (isPlainObject(t.openai)) patch.openai = t.openai;
  if (isPlainObject(t.elevenlabs)) patch.elevenlabs = t.elevenlabs;
  return patch;
}

export function defaultProfileId(): string {
  return (
    process.env.RENDER_PROFILE_ID?.trim() ||
    process.env.DEFAULT_RENDER_PROFILE?.trim() ||
    'cinematic_mystery'
  );
}

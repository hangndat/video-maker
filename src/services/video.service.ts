import fs from 'node:fs';
import path from 'node:path';
import '../shared/ffmpeg-env.js';
import ffmpeg from 'fluent-ffmpeg';
import type { CharacterAlignment } from '../types/elevenlabs.js';
import { characterAlignmentSchema } from '../types/elevenlabs.js';
import type { SceneEmotion } from '../types/script-schema.js';
import { ffprobeDurationSec } from '../shared/ffprobe.js';
import { tokenizeAlignment, type WordSpan } from './tokenize-alignment.js';
import type { JobPaths } from '../shared/path-provider.js';
import { runFfmpeg } from '../shared/ffmpeg-run.js';
import { pipelineLog } from '../shared/pipeline-log.js';

export type AssLayoutConfig = {
  playResX: number;
  playResY: number;
  /** Distance from bottom edge; use ~15% of PlayResY for TikTok safe zone */
  marginV: number;
  fontName: string;
  fontSize: number;
};

export type AssembleVideoInput = {
  paths: JobPaths;
  rawVideoPath: string;
  voiceAudioPath: string;
  alignment: CharacterAlignment;
  /** If provided, uses normalized_alignment from API instead */
  normalizedAlignment?: CharacterAlignment;
  bgmPath?: string;
  actualDurationSec?: number;
  layout?: Partial<AssLayoutConfig>;
};

const defaultLayout = (): AssLayoutConfig => {
  const playResX = 1080;
  const playResY = 1920;
  const pct = Number(process.env.TIKTOK_SAFE_BOTTOM_PCT ?? '0.15');
  return {
    playResX,
    playResY,
    marginV: Math.round(playResY * pct),
    fontName: process.env.ASS_FONT_NAME ?? 'Arial',
    fontSize: Number(process.env.ASS_FONT_SIZE ?? '72'),
  };
};

function escapeAssToken(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

function formatAssTimestamp(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const totalCs = Math.round(seconds * 100);
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function buildWordLevelAss(
  words: WordSpan[],
  layout: AssLayoutConfig,
): string {
  const header = [
    '[Script Info]',
    'Title: Ma Chu burn-in',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: ' + layout.playResX,
    'PlayResY: ' + layout.playResY,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: TikTokSafe,${layout.fontName},${layout.fontSize},&H00FFFFFF,&H000000FF,&H00222222,&H80000000,-1,0,0,0,100,100,0,0,3,3,2,2,48,48,${layout.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const dialogues = words.map((w) => {
    const start = formatAssTimestamp(w.startSec);
    const end = formatAssTimestamp(Math.max(w.endSec, w.startSec + 0.02));
    const text = escapeAssToken(w.text);
    return `Dialogue: 0,${start},${end},TikTokSafe,,0,0,0,,${text}`;
  });

  return `${header}\n${dialogues.join('\n')}\n`;
}

/** Escapes path for FFmpeg `ass=filename=...` in -filter_complex (Windows drive colons, quotes). */
export function escapePathForFfmpegSubtitles(filePath: string): string {
  let out = path.resolve(filePath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(out)) out = out.replace(/^([A-Za-z]):/, '$1\\:');
  out = out.replace(/'/g, "\\\\'");
  return out;
}


export async function writeAssFromAlignment(
  assOutPath: string,
  alignment: CharacterAlignment,
  normalized: CharacterAlignment | undefined,
  layoutPartial?: Partial<AssLayoutConfig>,
): Promise<WordSpan[]> {
  const layout = { ...defaultLayout(), ...layoutPartial };
  const align = normalized ?? alignment;
  const words = tokenizeAlignment(align);
  const ass = buildWordLevelAss(words, layout);
  await fs.promises.mkdir(path.dirname(assOutPath), { recursive: true });
  await fs.promises.writeFile(assOutPath, ass, 'utf8');
  return words;
}

export type AudioMixMode = 'simple' | 'ducking';

function buildAudioFilterComplex(
  hasBgm: boolean,
  mode: AudioMixMode,
  voiceDuration: number,
  bgmFadeOutSec: number,
): string {
  if (!hasBgm) return '';

  const fadeStart = Math.max(0, voiceDuration - bgmFadeOutSec);
  // Voice stays full; BGM lowered. Optional sidechain ducking when mode === ducking.
  if (mode === 'simple') {
    return [
      `[1:a]volume=1[a1]`,
      `[2:a]volume=${process.env.BGM_VOLUME ?? '0.2'},afade=t=out:st=${fadeStart}:d=${bgmFadeOutSec}[a2]`,
      `[a1][a2]amix=inputs=2:duration=first:normalize=0[mix]`,
      `[mix]alimiter=limit=0.95:attack=5:release=50[aout]`,
    ].join(';');
  }

  return [
    `[1:a]asplit[a1][vsc]`,
    `[2:a]volume=${process.env.BGM_VOLUME ?? '0.2'},afade=t=out:st=${fadeStart}:d=${bgmFadeOutSec}[bg]`,
    `[bg][vsc]sidechaincompress=threshold=0.05:ratio=9:attack=20:release=250[bgduck]`,
    `[a1][bgduck]amix=inputs=2:duration=first:normalize=0[mix]`,
    `[mix]alimiter=limit=0.95:attack=5:release=50[aout]`,
  ].join(';');
}

/** BGM mix when dialogue is already on input 0 (premuxed), BGM on input 1. */
function buildAudioFilterComplexPremuxed(
  hasBgm: boolean,
  mode: AudioMixMode,
  voiceDuration: number,
  bgmFadeOutSec: number,
): string {
  if (!hasBgm) return '';

  const fadeStart = Math.max(0, voiceDuration - bgmFadeOutSec);
  if (mode === 'simple') {
    return [
      `[0:a]volume=1[a1]`,
      `[1:a]volume=${process.env.BGM_VOLUME ?? '0.2'},afade=t=out:st=${fadeStart}:d=${bgmFadeOutSec}[a2]`,
      `[a1][a2]amix=inputs=2:duration=first:normalize=0[mix]`,
      `[mix]alimiter=limit=0.95:attack=5:release=50[aout]`,
    ].join(';');
  }

  return [
    `[0:a]asplit[a1][vsc]`,
    `[1:a]volume=${process.env.BGM_VOLUME ?? '0.2'},afade=t=out:st=${fadeStart}:d=${bgmFadeOutSec}[bg]`,
    `[bg][vsc]sidechaincompress=threshold=0.05:ratio=9:attack=20:release=250[bgduck]`,
    `[a1][bgduck]amix=inputs=2:duration=first:normalize=0[mix]`,
    `[mix]alimiter=limit=0.95:attack=5:release=50[aout]`,
  ].join(';');
}

export function assembleFinalVideo(input: AssembleVideoInput): Promise<void> {
  const layout = { ...defaultLayout(), ...input.layout };
  const alignment = characterAlignmentSchema.parse(input.alignment);
  const normalized = input.normalizedAlignment
    ? characterAlignmentSchema.parse(input.normalizedAlignment)
    : undefined;

  const mixMode = (process.env.AUDIO_MIX_MODE as AudioMixMode) ?? 'simple';
  if (mixMode !== 'simple' && mixMode !== 'ducking') {
    throw new Error('AUDIO_MIX_MODE must be simple or ducking');
  }

  return new Promise(async (resolve, reject) => {
    try {
      const words = tokenizeAlignment(normalized ?? alignment);
      const ass = buildWordLevelAss(words, layout);
      await fs.promises.mkdir(path.dirname(input.paths.subtitlesAss), {
        recursive: true,
      });
      await fs.promises.writeFile(input.paths.subtitlesAss, ass, 'utf8');
      await fs.promises.mkdir(path.dirname(input.paths.finalOutput), {
        recursive: true,
      });

      const assEsc = escapePathForFfmpegSubtitles(input.paths.subtitlesAss);
      const voiceDuration =
        input.actualDurationSec ??
        Math.max(
          ...alignment.character_end_times_seconds,
          alignment.character_end_times_seconds.at(-1) ?? 0,
        );

      const bgmFadeOut = Number(process.env.BGM_FADE_OUT_SEC ?? '2');
      const hasBgm = Boolean(input.bgmPath && fs.existsSync(input.bgmPath));

      const eff = ffmpeg();
      eff.input(input.rawVideoPath).inputOptions(['-stream_loop', '-1']);
      eff.input(input.voiceAudioPath);

      if (hasBgm) eff.input(input.bgmPath!);

      if (!hasBgm) {
        eff.complexFilter(
          [`[0:v]ass=filename=${assEsc}[vout]`, `[1:a]anull[aout]`].join(';'),
          ['vout', 'aout'],
        );
      } else {
        const audioGraph = buildAudioFilterComplex(
          true,
          mixMode,
          voiceDuration,
          bgmFadeOut,
        );
        eff.complexFilter(
          [`[0:v]ass=filename=${assEsc}[vout]`, audioGraph].join(';'),
          ['vout', 'aout'],
        );
      }

      eff
        .on('start', (cmd) => {
          if (process.env.DEBUG_FFMPEG === '1') console.error(cmd);
        })
        .on('error', (err, _stdout, stderr) => {
          reject(
            new Error(
              `${err.message}${stderr ? '\n' + stderr : ''}`,
            ),
          );
        })
        .on('end', () => resolve())
        .output(input.paths.finalOutput)
        .outputOptions(['-shortest', '-map_metadata', '-1'])
        .videoCodec('libx264')
        .audioCodec('aac')
        .run();
    } catch (e) {
      reject(e);
    }
  });
}

export type SceneAlignmentChunk = {
  alignment: CharacterAlignment;
  normalizedAlignment?: CharacterAlignment;
  durationSec: number;
};

/**
 * Concatenates per-scene ElevenLabs alignments with time offsets for one continuous ASS timeline.
 */
export function mergeSceneAlignments(
  parts: SceneAlignmentChunk[],
): {
  alignment: CharacterAlignment;
  normalizedAlignment?: CharacterAlignment;
} {
  const mergeBranch = (
    pick: (p: SceneAlignmentChunk) => CharacterAlignment | undefined,
  ): CharacterAlignment | undefined => {
    if (parts.some((p) => pick(p) === undefined)) return undefined;
    let offset = 0;
    const characters: string[] = [];
    const character_start_times_seconds: number[] = [];
    const character_end_times_seconds: number[] = [];
    for (const p of parts) {
      const a = pick(p)!;
      for (let i = 0; i < a.characters.length; i++) {
        characters.push(a.characters[i]);
        character_start_times_seconds.push(
          a.character_start_times_seconds[i] + offset,
        );
        character_end_times_seconds.push(
          a.character_end_times_seconds[i] + offset,
        );
      }
      offset += p.durationSec;
    }
    return {
      characters,
      character_start_times_seconds,
      character_end_times_seconds,
    };
  };

  const alignment = mergeBranch((p) => p.alignment)!;
  const normalizedAlignment = mergeBranch((p) => p.normalizedAlignment);
  return { alignment, normalizedAlignment };
}

/** Maps script emotion → FFmpeg motion preset (independent of Comfy driving clip). */
function sceneEmotionToFfmpegPreset(
  emotion: SceneEmotion,
):
  | 'zoom_in_fast'
  | 'laugh_zoom'
  | 'zoom_mild'
  | 'pan_left'
  | 'camera_shake' {
  switch (emotion) {
    /** Zoom mạnh hơn `zoom_in_fast` để cảnh laugh dễ phân biệt với shake/pan. */
    case 'laugh':
      return 'laugh_zoom';
    case 'zoom_in_fast':
      return 'zoom_in_fast';
    /** Khác `laugh`: zoom chậm hơn — trước đây gộp chung khiến cảnh default trông giống cười. */
    case 'default':
      return 'zoom_mild';
    case 'confused':
    case 'thinking':
    case 'pan_left':
      return 'pan_left';
    case 'angry':
    case 'camera_shake':
      return 'camera_shake';
    default: {
      const _e: never = emotion;
      return _e;
    }
  }
}

/** Nhãn preset FFmpeg (log / debug). */
export function sceneEmotionToFfmpegMotionLabel(emotion: SceneEmotion): string {
  return sceneEmotionToFfmpegPreset(emotion);
}

/** Video filter chain after 1080×1920 base scale/crop; prepend `[0:v]` and append `[vout]` in the caller. */
function buildSceneEmotionVideoFilters(
  emotion: SceneEmotion,
  durationSec: number,
  fps: number,
): string {
  const preset = sceneEmotionToFfmpegPreset(emotion);
  const base =
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1';
  const d = Math.max(0.001, durationSec);
  switch (preset) {
    case 'zoom_in_fast':
      return `${base},zoompan=z='min(zoom+0.065,1.78)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${fps}`;
    case 'laugh_zoom':
      return `${base},zoompan=z='min(zoom+0.09,2.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${fps}`;
    case 'zoom_mild':
      return `${base},zoompan=z='min(zoom+0.032,1.45)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${fps}`;
    case 'pan_left':
      return `${base},crop=w=trunc(iw*0.88):h=ih:x='trunc(max(0,(iw-ow)*(1-t/${d})))':y=0`;
    case 'camera_shake':
      return `${base},crop=w=trunc(iw*0.9):h=trunc(ih*0.9):x='trunc((iw-ow)/2+14*sin(2*PI*5.5*t))':y='trunc((ih-oh)/2+11*cos(2*PI*6.5*t))'`;
    default: {
      const _p: never = preset;
      return _p;
    }
  }
}

export type CreateSceneClipInput = {
  rawVideoPath: string;
  sceneAudioPath: string;
  emotion: SceneEmotion;
  outputPath: string;
  /** zoompan output fps; default 30 */
  fps?: number;
};

/**
 * One scene: loop Comfy raw video to cover scene audio length, apply motion by `emotion`, encode mp4 (H.264 + AAC).
 */
export function createSceneClip(input: CreateSceneClipInput): Promise<void> {
  const fps = input.fps ?? 30;
  return new Promise(async (resolve, reject) => {
    try {
      let durationSec: number;
      try {
        durationSec = await ffprobeDurationSec(input.sceneAudioPath);
      } catch {
        durationSec = 1;
      }
      const motion = sceneEmotionToFfmpegPreset(input.emotion);
      pipelineLog('ffmpeg.scene_clip', {
        emotion: input.emotion,
        ffmpegMotion: motion,
        durationSec,
        out: path.basename(input.outputPath),
        note:
          'Biểu cảm mặt = từ raw-scene-{id}.mp4 (LivePortrait + driving theo cảnh). emotion cảnh chỉ thêm filter camera FFmpeg.',
      });
      const vChain = buildSceneEmotionVideoFilters(
        input.emotion,
        durationSec,
        fps,
      );
      await fs.promises.mkdir(path.dirname(input.outputPath), {
        recursive: true,
      });

      ffmpeg()
        .input(input.rawVideoPath)
        .inputOptions(['-stream_loop', '-1'])
        .input(input.sceneAudioPath)
        .complexFilter(
          // Force constant 30 fps so concat + audio stay aligned (mixed fps was shortening video vs audio).
          [`[0:v]${vChain},fps=30[vout]`, `[1:a]anull[aout]`].join(';'),
          ['vout', 'aout'],
        )
        .outputOptions(['-shortest', '-map_metadata', '-1'])
        .videoCodec('libx264')
        .audioCodec('aac')
        .output(input.outputPath)
        .on('start', (cmd) => {
          if (process.env.DEBUG_FFMPEG === '1') console.error(cmd);
        })
        .on('error', (err, _stdout, stderr) => {
          reject(
            new Error(`${err.message}${stderr ? '\n' + stderr : ''}`),
          );
        })
        .on('end', () => resolve())
        .run();
    } catch (e) {
      reject(e);
    }
  });
}

/** Concat re-encoded scene mp4s (same layout) into one file. */
export function concatSceneClips(
  clipPaths: string[],
  listFilePath: string,
  outputPath: string,
): Promise<void> {
  if (clipPaths.length === 0) {
    return Promise.reject(new Error('concatSceneClips: empty clipPaths'));
  }
  return (async () => {
    await fs.promises.mkdir(path.dirname(listFilePath), { recursive: true });
    const body = clipPaths
      .map((p) => {
        const abs = path.resolve(p).replace(/\\/g, '/');
        const escaped = abs.replace(/'/g, `'\\''`);
        return `file '${escaped}'`;
      })
      .join('\n');
    await fs.promises.writeFile(listFilePath, body + '\n', 'utf8');
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listFilePath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c:v',
          'libx264',
          '-preset',
          process.env.FFMPEG_PRESET ?? 'veryfast',
          '-crf',
          process.env.FFMPEG_CRF ?? '20',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          '-map_metadata',
          '-1',
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          if (process.env.DEBUG_FFMPEG === '1') console.error(cmd);
        })
        .on('error', (err, _stdout, stderr) => {
          reject(
            new Error(`${err.message}${stderr ? '\n' + stderr : ''}`),
          );
        })
        .on('end', () => resolve())
        .run();
    });
  })();
}

export type AssemblePremuxedInput = {
  paths: JobPaths;
  /** Already muxed video + final dialogue (e.g. multi-scene concat). */
  videoWithAudioPath: string;
  alignment: CharacterAlignment;
  normalizedAlignment?: CharacterAlignment;
  bgmPath?: string;
  actualDurationSec?: number;
  layout?: Partial<AssLayoutConfig>;
};

/** Burn ASS and optional BGM onto a single premuxed mp4 (no raw loop / separate voice file). */
export function assembleFinalVideoPremuxed(
  input: AssemblePremuxedInput,
): Promise<void> {
  const layout = { ...defaultLayout(), ...input.layout };
  const alignment = characterAlignmentSchema.parse(input.alignment);
  const normalized = input.normalizedAlignment
    ? characterAlignmentSchema.parse(input.normalizedAlignment)
    : undefined;

  const mixMode = (process.env.AUDIO_MIX_MODE as AudioMixMode) ?? 'simple';
  if (mixMode !== 'simple' && mixMode !== 'ducking') {
    throw new Error('AUDIO_MIX_MODE must be simple or ducking');
  }

  return new Promise(async (resolve, reject) => {
    try {
      const words = tokenizeAlignment(normalized ?? alignment);
      const ass = buildWordLevelAss(words, layout);
      await fs.promises.mkdir(path.dirname(input.paths.subtitlesAss), {
        recursive: true,
      });
      await fs.promises.writeFile(input.paths.subtitlesAss, ass, 'utf8');
      await fs.promises.mkdir(path.dirname(input.paths.finalOutput), {
        recursive: true,
      });

      const assEsc = escapePathForFfmpegSubtitles(input.paths.subtitlesAss);
      const voiceDuration =
        input.actualDurationSec ??
        Math.max(
          ...alignment.character_end_times_seconds,
          alignment.character_end_times_seconds.at(-1) ?? 0,
        );

      const bgmFadeOut = Number(process.env.BGM_FADE_OUT_SEC ?? '2');
      const hasBgm = Boolean(input.bgmPath && fs.existsSync(input.bgmPath));

      const eff = ffmpeg();
      eff.input(input.videoWithAudioPath);
      if (hasBgm) eff.input(input.bgmPath!);

      if (!hasBgm) {
        eff.complexFilter(
          [`[0:v]ass=filename=${assEsc}[vout]`, `[0:a]anull[aout]`].join(
            ';',
          ),
          ['vout', 'aout'],
        );
      } else {
        const audioGraph = buildAudioFilterComplexPremuxed(
          true,
          mixMode,
          voiceDuration,
          bgmFadeOut,
        );
        eff.complexFilter(
          [`[0:v]ass=filename=${assEsc}[vout]`, audioGraph].join(';'),
          ['vout', 'aout'],
        );
      }

      eff
        .on('start', (cmd) => {
          if (process.env.DEBUG_FFMPEG === '1') console.error(cmd);
        })
        .on('error', (err, _stdout, stderr) => {
          reject(
            new Error(
              `${err.message}${stderr ? '\n' + stderr : ''}`,
            ),
          );
        })
        .on('end', () => resolve())
        .output(input.paths.finalOutput)
        .outputOptions(['-map_metadata', '-1'])
        .videoCodec('libx264')
        .audioCodec('aac')
        .run();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Produces a mergeable mp4 for smoke tests when Comfy output is absent.
 * Uses raw ffmpeg (not fluent-ffmpeg) because lavfi format detection breaks with ffmpeg 7+/8+ -formats table vs fluent-ffmpeg regex.
 */
export async function generateColorBarsVideo(
  outPath: string,
  w = 1080,
  h = 1920,
  durationSec = 30,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${w}x${h}:r=30`,
    '-t',
    String(durationSec),
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    outPath,
  ]);
}

export async function generateSineMp3(
  outPath: string,
  durationSec: number,
  freq = 440,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freq}:sample_rate=44100`,
    '-t',
    String(durationSec),
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    outPath,
  ]);
}

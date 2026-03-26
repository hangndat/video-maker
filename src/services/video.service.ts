import fs from 'node:fs';
import path from 'node:path';
import '../shared/ffmpeg-env.js';
import ffmpeg from 'fluent-ffmpeg';
import type { CharacterAlignment } from '../types/elevenlabs.js';
import { characterAlignmentSchema } from '../types/elevenlabs.js';
import type { SceneMotion } from '../types/script-schema.js';
import { ffprobeDurationSec } from '../shared/ffprobe.js';
import { tokenizeAlignment, type WordSpan } from './tokenize-alignment.js';
import type { JobPaths } from '../shared/path-provider.js';
import { runFfmpeg } from '../shared/ffmpeg-run.js';
import { pipelineLog } from '../shared/pipeline-log.js';

export type AssLayoutConfig = {
  playResX: number;
  playResY: number;
  marginV: number;
  fontName: string;
  fontSize: number;
  /** ASS primary colour &HAABBGGRR */
  primaryAssColor: string;
  /** ASS highlight / emphasis colour */
  highlightAssColor: string;
};

export type AssembleVideoInput = {
  paths: JobPaths;
  rawVideoPath: string;
  voiceAudioPath: string;
  alignment: CharacterAlignment;
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
    primaryAssColor: process.env.ASS_PRIMARY_COLOR ?? '&H00FFFFFF',
    highlightAssColor: process.env.ASS_HIGHLIGHT_COLOR ?? '&H0000BFFF',
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

function wordEmphasisAss(
  rawWord: string,
  layout: AssLayoutConfig,
  emphasisWords: string[],
): string {
  const t = escapeAssToken(rawWord);
  if (!emphasisWords.length) return t;
  const lower = rawWord.toLowerCase();
  const hit = emphasisWords.some(
    (e) =>
      lower === e.toLowerCase() || lower.includes(e.toLowerCase()),
  );
  if (!hit) return t;
  const hc = layout.highlightAssColor.replace(/^&H/i, '&H');
  return `{\\b1\\c${hc}}${t}{\\r}`;
}

export function buildWordLevelAss(
  words: WordSpan[],
  layout: AssLayoutConfig,
  emphasisWords: string[] = [],
): string {
  const pc = layout.primaryAssColor.replace(/^&H/i, '&H');
  const header = [
    '[Script Info]',
    'Title: Cinematic burn-in',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: ' + layout.playResX,
    'PlayResY: ' + layout.playResY,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: TikTokSafe,${layout.fontName},${layout.fontSize},${pc},&H000000FF,&H00222222,&H80000000,-1,0,0,0,100,100,0,0,3,3,2,2,48,48,${layout.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const dialogues = words.map((w) => {
    const start = formatAssTimestamp(w.startSec);
    const end = formatAssTimestamp(Math.max(w.endSec, w.startSec + 0.02));
    const text = wordEmphasisAss(w.text, layout, emphasisWords);
    return `Dialogue: 0,${start},${end},TikTokSafe,,0,0,0,,${text}`;
  });

  return `${header}\n${dialogues.join('\n')}\n`;
}

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
  emphasisWords: string[] = [],
): Promise<WordSpan[]> {
  const layout = { ...defaultLayout(), ...layoutPartial };
  const align = normalized ?? alignment;
  const words = tokenizeAlignment(align);
  const ass = buildWordLevelAss(words, layout, emphasisWords);
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
  bgmVolume: number,
): string {
  if (!hasBgm) return '';

  const fadeStart = Math.max(0, voiceDuration - bgmFadeOutSec);
  if (mode === 'simple') {
    return [
      `[1:a]volume=1[a1]`,
      `[2:a]volume=${bgmVolume},afade=t=out:st=${fadeStart}:d=${bgmFadeOutSec}[a2]`,
      `[a1][a2]amix=inputs=2:duration=first:normalize=0[mix]`,
      `[mix]alimiter=limit=0.95:attack=5:release=50[aout]`,
    ].join(';');
  }

  return [
    `[1:a]asplit[a1][vsc]`,
    `[2:a]volume=${bgmVolume},afade=t=out:st=${fadeStart}:d=${bgmFadeOutSec}[bg]`,
    `[bg][vsc]sidechaincompress=threshold=0.05:ratio=9:attack=20:release=250[bgduck]`,
    `[a1][bgduck]amix=inputs=2:duration=first:normalize=0[mix]`,
    `[mix]alimiter=limit=0.95:attack=5:release=50[aout]`,
  ].join(';');
}

function buildAudioFilterComplexPremuxed(
  hasBgm: boolean,
  mode: AudioMixMode,
  voiceDuration: number,
  bgmFadeOutSec: number,
  bgmVolume: number,
): string {
  if (!hasBgm) return '';

  const fadeStart = Math.max(0, voiceDuration - bgmFadeOutSec);
  if (mode === 'simple') {
    return [
      `[0:a]volume=1[a1]`,
      `[1:a]volume=${bgmVolume},afade=t=out:st=${fadeStart}:d=${bgmFadeOutSec}[a2]`,
      `[a1][a2]amix=inputs=2:duration=first:normalize=0[mix]`,
      `[mix]alimiter=limit=0.95:attack=5:release=50[aout]`,
    ].join(';');
  }

  return [
    `[0:a]asplit[a1][vsc]`,
    `[1:a]volume=${bgmVolume},afade=t=out:st=${fadeStart}:d=${bgmFadeOutSec}[bg]`,
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
      const bgmVol = Number(process.env.BGM_VOLUME ?? '0.2');

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
          bgmVol,
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

function buildBrollMotionChain(
  motion: SceneMotion,
  durationSec: number,
  fps: number,
): string {
  const base =
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1';
  const d = Math.max(0.001, durationSec);
  switch (motion) {
    case 'static':
      return base;
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
      const _m: never = motion;
      return _m;
    }
  }
}

export function sceneMotionToLabel(motion: SceneMotion): string {
  return motion;
}

export type CreateBrollSceneClipInput = {
  sourceVideoPath: string;
  sceneAudioPath: string;
  motion: SceneMotion;
  segmentVideoMode: 'freeze_last' | 'loop';
  outputPath: string;
  fps?: number;
};

/**
 * One segment: mux B-roll + scene narration. `freeze_last` plays source once then holds last frame to match audio.
 */
export function createBrollSceneClip(input: CreateBrollSceneClipInput): Promise<void> {
  const fps = input.fps ?? 30;
  return new Promise(async (resolve, reject) => {
    try {
      let audioDur: number;
      try {
        audioDur = await ffprobeDurationSec(input.sceneAudioPath);
      } catch {
        audioDur = 1;
      }
      let videoDur: number;
      try {
        videoDur = await ffprobeDurationSec(input.sourceVideoPath);
      } catch {
        videoDur = 0;
      }
      if (videoDur <= 0) {
        reject(new Error(`B-roll duration invalid: ${input.sourceVideoPath}`));
        return;
      }

      const playDur = Math.min(videoDur, audioDur);
      const padDur = Math.max(0, audioDur - playDur);

      pipelineLog('ffmpeg.broll_clip', {
        motion: input.motion,
        segmentVideoMode: input.segmentVideoMode,
        audioDur,
        videoDur,
        playDur,
        padDur,
        out: path.basename(input.outputPath),
      });

      const motionChain = buildBrollMotionChain(input.motion, playDur, fps);
      await fs.promises.mkdir(path.dirname(input.outputPath), {
        recursive: true,
      });

      if (input.segmentVideoMode === 'loop') {
        ffmpeg()
          .input(input.sourceVideoPath)
          .inputOptions(['-stream_loop', '-1'])
          .input(input.sceneAudioPath)
          .complexFilter(
            [
              `[0:v]${motionChain},fps=${fps}[vout]`,
              `[1:a]anull[aout]`,
            ].join(';'),
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
        return;
      }

      const padStr = padDur.toFixed(3);
      const playStr = playDur.toFixed(3);
      const freezeChain = [
        `[0:v]${motionChain},fps=${fps},setpts=PTS-STARTPTS[vbase]`,
        `[vbase]trim=duration=${playStr},setpts=PTS-STARTPTS[vtrim]`,
        `[vtrim]tpad=stop_mode=clone:stop_duration=${padStr}[vout]`,
        `[1:a]anull[aout]`,
      ].join(';');

      ffmpeg()
        .input(input.sourceVideoPath)
        .input(input.sceneAudioPath)
        .complexFilter(freezeChain, ['vout', 'aout'])
        .outputOptions(['-map_metadata', '-1'])
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

export type SfxTimelineEntry = { filePath: string; offsetSec: number };

export type AssemblePremuxedInput = {
  paths: JobPaths;
  videoWithAudioPath: string;
  alignment: CharacterAlignment;
  normalizedAlignment?: CharacterAlignment;
  bgmPath?: string;
  actualDurationSec?: number;
  layout?: Partial<AssLayoutConfig>;
  emphasisWords?: string[];
  sfxTimeline?: SfxTimelineEntry[];
  /** When true, use effective config ducking instead of env only */
  audioDucking?: boolean;
  bgmVolume?: number;
};

function buildPremuxedComplexFilter(args: {
  assEsc: string;
  voiceDuration: number;
  hasBgm: boolean;
  bgmPath: string;
  mixMode: AudioMixMode;
  bgmFadeOut: number;
  bgmVolume: number;
  sfxList: SfxTimelineEntry[];
}): { filter: string; outputs: string[] } {
  const { assEsc, voiceDuration, hasBgm, mixMode, bgmFadeOut, bgmVolume } = args;
  const sfxList = args.sfxList.filter((s) => fs.existsSync(s.filePath));

  const videoPart = `[0:v]ass=filename=${assEsc}[vout]`;

  if (!sfxList.length) {
    if (!hasBgm) {
      return {
        filter: `${videoPart};[0:a]anull[aout]`,
        outputs: ['vout', 'aout'],
      };
    }
    const audioGraph = buildAudioFilterComplexPremuxed(
      true,
      mixMode,
      voiceDuration,
      bgmFadeOut,
      bgmVolume,
    );
    return {
      filter: `${videoPart};${audioGraph}`,
      outputs: ['vout', 'aout'],
    };
  }

  let nextInput = 1 + (hasBgm ? 1 : 0);
  const parts: string[] = [videoPart];
  const amixLabels: string[] = [];

  parts.push(`[0:a]anull[avoice]`);
  amixLabels.push('[avoice]');

  for (let i = 0; i < sfxList.length; i++) {
    const sfx = sfxList[i]!;
    const idx = nextInput++;
    const delayMs = Math.max(0, Math.round(sfx.offsetSec * 1000));
    const lab = `sfx${i}`;
    parts.push(
      `[${idx}:a]adelay=${delayMs}|${delayMs}[${lab}]`,
    );
    amixLabels.push(`[${lab}]`);
  }

  const n = amixLabels.length;
  parts.push(
    `${amixLabels.join('')}amix=inputs=${n}:duration=first:normalize=0[amixed]`,
  );

  if (!hasBgm) {
    parts.push('[amixed]alimiter=limit=0.95:attack=5:release=50[aout]');
    return { filter: parts.join(';'), outputs: ['vout', 'aout'] };
  }

  const fadeStart = Math.max(0, voiceDuration - bgmFadeOut);
  const bgmIdx = 1;
  if (mixMode === 'simple') {
    parts.push(
      `[${bgmIdx}:a]volume=${bgmVolume},afade=t=out:st=${fadeStart}:d=${bgmFadeOut}[bg]`,
      `[amixed][bg]amix=inputs=2:duration=first:normalize=0[mixbg]`,
      `[mixbg]alimiter=limit=0.95:attack=5:release=50[aout]`,
    );
  } else {
    parts.push(
      `[amixed]asplit[aforbg][vsc]`,
      `[${bgmIdx}:a]volume=${bgmVolume},afade=t=out:st=${fadeStart}:d=${bgmFadeOut}[bg]`,
      `[bg][vsc]sidechaincompress=threshold=0.05:ratio=9:attack=20:release=250[bgduck]`,
      `[aforbg][bgduck]amix=inputs=2:duration=first:normalize=0[mixbg]`,
      `[mixbg]alimiter=limit=0.95:attack=5:release=50[aout]`,
    );
  }

  return { filter: parts.join(';'), outputs: ['vout', 'aout'] };
}

export function assembleFinalVideoPremuxed(
  input: AssemblePremuxedInput,
): Promise<void> {
  const layout = { ...defaultLayout(), ...input.layout };
  const alignment = characterAlignmentSchema.parse(input.alignment);
  const normalized = input.normalizedAlignment
    ? characterAlignmentSchema.parse(input.normalizedAlignment)
    : undefined;

  const mixMode: AudioMixMode =
    input.audioDucking === true || process.env.AUDIO_MIX_MODE === 'ducking'
      ? 'ducking'
      : 'simple';
  const bgmVol =
    input.bgmVolume ?? Number(process.env.BGM_VOLUME ?? '0.2');

  return new Promise(async (resolve, reject) => {
    try {
      const emphasis = input.emphasisWords ?? [];
      const words = tokenizeAlignment(normalized ?? alignment);
      const ass = buildWordLevelAss(words, layout, emphasis);
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
      const sfxList = input.sfxTimeline ?? [];

      const eff = ffmpeg();
      eff.input(input.videoWithAudioPath);

      let bgmInputAdded = false;
      if (hasBgm) {
        eff.input(input.bgmPath!);
        bgmInputAdded = true;
      }

      const sfxEntries = sfxList.filter((s) => fs.existsSync(s.filePath));
      for (const s of sfxEntries) {
        eff.input(s.filePath);
      }

      if (!bgmInputAdded && sfxEntries.length === 0) {
        eff.complexFilter(
          [
            `[0:v]ass=filename=${assEsc}[vout]`,
            `[0:a]anull[aout]`,
          ].join(';'),
          ['vout', 'aout'],
        );
      } else {
        const { filter, outputs } = buildPremuxedComplexFilter({
          assEsc,
          voiceDuration,
          hasBgm: bgmInputAdded,
          bgmPath: input.bgmPath ?? '',
          mixMode,
          bgmFadeOut,
          bgmVolume: bgmVol,
          sfxList: sfxEntries,
        });
        eff.complexFilter(filter, outputs);
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

export async function extractLastFramePng(
  videoPath: string,
  outPngPath: string,
): Promise<void> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`extractLastFramePng: missing video ${videoPath}`);
  }
  await fs.promises.mkdir(path.dirname(outPngPath), { recursive: true });
  await runFfmpeg([
    '-y',
    '-sseof',
    '-0.125',
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outPngPath,
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

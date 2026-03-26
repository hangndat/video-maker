import { z } from 'zod';

/** OpenAI often returns "" instead of omitting optional keys — treat as undefined. */
function emptyToUndefined<I extends unknown>(val: I): I | undefined {
  return val === '' || val === null ? undefined : val;
}

/** FFmpeg-friendly motion presets for B-roll (no avatar). */
export const sceneMotionSchema = z.enum([
  'static',
  'zoom_in_fast',
  'zoom_mild',
  'laugh_zoom',
  'pan_left',
  'camera_shake',
]);

export type SceneMotion = z.infer<typeof sceneMotionSchema>;

export const segmentVideoModeSchema = z.enum(['freeze_last', 'loop']);

export const scriptSceneSchema = z.object({
  id: z.number().int().positive(),
  /** Plain text for ElevenLabs (no markdown). */
  text: z.string().min(1),
  /**
   * Optional ASS line; if set and differs from `text`, alignment still uses `text` (must match TTS).
   * MVP: omit — use `emphasisWords` for bold highlights on ASS.
   */
  captionText: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  /** Substrings to render bold in ASS (matched per token). */
  emphasisWords: z.array(z.string().min(1)).max(32).optional(),
  /**
   * B-roll MP4: absolute or relative to DATA_ROOT.
   * When missing, preset `videoDefault.placeholderRelativePath` is used.
   */
  videoPath: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  motion: sceneMotionSchema,
  /** Override preset / global segment video mode. */
  videoMode: z.preprocess(
    emptyToUndefined,
    segmentVideoModeSchema.optional(),
  ),
  /** Optional SFX key into preset `audio.sfx` map (played at segment start). */
  sfxKey: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
});

export type ScriptScene = z.infer<typeof scriptSceneSchema>;

export const scriptOutputSchema = z.object({
  scenes: z.array(scriptSceneSchema).min(1),
  duration_estimate: z.number().nonnegative().optional(),
  actual_duration: z.number().nonnegative().optional(),
});

export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

export function scriptScenesFullText(scenes: ScriptScene[]): string {
  return scenes.map((s) => s.text).join(' ');
}

/** Remove `**...**` markers for TTS; single pass, non-greedy. */
export function stripMarkdownBoldForTts(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').trim();
}

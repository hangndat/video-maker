import { z } from 'zod';

/**
 * Scene mood: drives FFmpeg filters + (first scene) Comfy driving reference under
 * `assets/driving/`. Legacy camera-only tags still accepted for old jobs.
 */
export const sceneEmotionSchema = z.enum([
  'angry',
  'laugh',
  'confused',
  'thinking',
  'default',
  'zoom_in_fast',
  'pan_left',
  'camera_shake',
]);

export type SceneEmotion = z.infer<typeof sceneEmotionSchema>;

export const scriptSceneSchema = z.object({
  id: z.number().int().positive(),
  text: z.string().min(1),
  emotion: sceneEmotionSchema,
});

export type ScriptScene = z.infer<typeof scriptSceneSchema>;

export const scriptOutputSchema = z.object({
  scenes: z.array(scriptSceneSchema).min(1),
  /** Legacy total duration hint; optional, pipeline may derive from audio. */
  duration_estimate: z.number().nonnegative().optional(),
  actual_duration: z.number().nonnegative().optional(),
});

export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

export function scriptScenesFullText(scenes: ScriptScene[]): string {
  return scenes.map((s) => s.text).join(' ');
}

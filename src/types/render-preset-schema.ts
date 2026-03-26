import { z } from 'zod';
import {
  sceneMotionSchema,
  segmentVideoModeSchema,
} from './script-schema.js';

export const voiceSettingsPresetSchema = z
  .object({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    use_speaker_boost: z.boolean().optional(),
  })
  .strict()
  .partial();

export const renderPresetFileSchema = z
  .object({
    schemaVersion: z.number().int().positive().default(1),
    ass: z
      .object({
        fontName: z.string().optional(),
        fontSize: z.number().positive().optional(),
        /** ASS &HAABBGGRR e.g. &H00D4AF37 */
        primaryColor: z.string().optional(),
        highlightColor: z.string().optional(),
        marginV: z.number().int().nonnegative().optional(),
      })
      .strict()
      .partial()
      .optional(),
    videoDefault: z
      .object({
        segmentVideoMode: segmentVideoModeSchema.optional(),
        outputFps: z.number().int().positive().max(60).optional(),
        /** Relative DATA_ROOT — used when scene has no videoPath (idea-only script). */
        placeholderRelativePath: z.string().min(1).optional(),
      })
      .strict()
      .partial()
      .optional(),
    motionDefault: sceneMotionSchema.optional(),
    audio: z
      .object({
        bgmRelativePath: z.string().optional(),
        bgmVolume: z.number().nonnegative().optional(),
        ducking: z.boolean().optional(),
        /** Map logical key → path relative DATA_ROOT (e.g. assets/sfx/woosh.mp3) */
        sfx: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .partial()
      .optional(),
    openai: z
      .object({
        temperature: z.number().min(0).max(2).optional(),
        model: z.string().optional(),
      })
      .strict()
      .partial()
      .optional(),
    elevenlabs: z
      .object({
        voice_settings: voiceSettingsPresetSchema.optional(),
      })
      .strict()
      .partial()
      .optional(),
  })
  .strict();

export type RenderPresetFile = z.infer<typeof renderPresetFileSchema>;

/** Partial patch merged over resolved preset (API `tuning`). Same shape as preset file; unknown keys ignored downstream. */
export const renderTuningSchema = z.record(z.string(), z.unknown());

export type RenderTuning = Record<string, unknown>;

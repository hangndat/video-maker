import { z } from 'zod';
import { characterAlignmentSchema } from './elevenlabs.js';

export const audioWithTimestampsResponseSchema = z.object({
  audio_base64: z.string(),
  alignment: characterAlignmentSchema.optional(),
  normalized_alignment: characterAlignmentSchema.optional(),
});

export type AudioWithTimestampsResponse = z.infer<
  typeof audioWithTimestampsResponseSchema
>;

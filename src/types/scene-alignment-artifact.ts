import { z } from 'zod';
import { characterAlignmentSchema } from './elevenlabs.js';

export const sceneAlignmentArtifactSchema = z.object({
  alignment: characterAlignmentSchema,
  normalizedAlignment: characterAlignmentSchema.optional(),
});

export type SceneAlignmentArtifact = z.infer<typeof sceneAlignmentArtifactSchema>;

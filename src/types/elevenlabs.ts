import { z } from 'zod';

export const characterAlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});

export type CharacterAlignment = z.infer<typeof characterAlignmentSchema>;

export function assertAlignmentShape(a: CharacterAlignment): void {
  const n = a.characters.length;
  if (
    a.character_start_times_seconds.length !== n ||
    a.character_end_times_seconds.length !== n
  ) {
    throw new Error(
      'Alignment arrays must match characters length (ElevenLabs contract).',
    );
  }
}

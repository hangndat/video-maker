import { z } from 'zod';

const looseNested = z.record(z.string(), z.unknown());

/**
 * Hồ sơ nhân vật khai báo v1: các nhóm field gợi ý + `.passthrough()` để giữ key tùy biến
 * (vd. `camera_lens_mm` ở root) mà không lỗi parse.
 */
export const characterProfileV1Schema = z
  .object({
    schema_version: z.number().optional(),
    subject: looseNested.optional(),
    biometrics: looseNested.optional(),
    camera: looseNested.optional(),
    wardrobe_anchor: looseNested.optional(),
    consistency: looseNested.optional(),
  })
  .passthrough();

export type CharacterProfileV1 = z.infer<typeof characterProfileV1Schema>;

/** Môi trường / bối cảnh (job hoặc override theo cảnh). */
export const environmentContextV1Schema = z
  .object({
    lighting: z.union([z.string(), looseNested]).optional(),
    set: z.string().optional(),
    global: z.string().optional(),
  })
  .passthrough();

export type EnvironmentContextV1 = z.infer<typeof environmentContextV1Schema>;

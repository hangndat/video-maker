import type { ScriptScene } from './script-schema.js';

export type JobMeta = {
  jobId: string;
  idea?: string;
  script: {
    scenes: ScriptScene[];
    duration_estimate?: number;
    actual_duration?: number;
  };
  voice?: {
    audioPath: string;
    actualDurationSec: number;
    hasNormalizedAlignment: boolean;
  };
  comfy?: {
    promptId?: string;
    /** Bản mirror cảnh đầu hoặc file legacy một-track; ưu tiên `sceneRawById` khi có. */
    rawVideoPath?: string;
    /** raw-scene-{id}.mp4 sau Comfy từng cảnh */
    sceneRawById?: Record<string, string>;
  };
  errors?: string[];
};

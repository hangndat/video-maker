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
    rawVideoPath?: string;
  };
  errors?: string[];
};

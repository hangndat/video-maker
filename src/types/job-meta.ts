import type { ScriptScene } from './script-schema.js';
import type { EffectiveRenderConfig } from '../services/render-config.js';

export type JobMeta = {
  jobId: string;
  idea?: string;
  profileId?: string;
  presetPath?: string;
  presetContentSha256?: string;
  effectiveRenderConfig?: EffectiveRenderConfig;
  tuning?: Record<string, unknown>;
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
  /** Per-scene B-roll sources copied under job `media/scenes/source-{id}.mp4` */
  media?: {
    sceneSourceById?: Record<string, string>;
  };
  errors?: string[];
};

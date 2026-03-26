import type { ScriptScene } from './script-schema.js';
import type {
  CharacterProfileV1,
  EnvironmentContextV1,
} from './character-profile-schema.js';

/** Tuỳ chọn nhất quán hình / Comfy (chain frame, IP-Adapter ref). */
export type JobVisualMeta = {
  /** Frame cuối raw-scene trước làm ảnh nguồn LivePortrait cho cảnh kế. */
  chainComfyFrames?: boolean;
  /** Tương đối `DATA_ROOT` hoặc absolute; ảnh copy vào Comfy input khi có `COMFY_NODE_IP_ADAPTER_IMAGE`. */
  ipAdapterReferencePath?: string;
};

export type JobMeta = {
  jobId: string;
  idea?: string;
  /** Hồ sơ nhân vật khai báo (v1 — xem `characterProfileV1Schema`). */
  characterProfile?: CharacterProfileV1;
  /** Bối cảnh / môi trường mặc định cả job (tách khỏi nhân vật trong tài liệu §11). */
  environment?: EnvironmentContextV1;
  visual?: JobVisualMeta;
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

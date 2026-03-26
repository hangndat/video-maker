import fs from 'node:fs';
import path from 'node:path';

/**
 * Basenames under `{DATA_ROOT}/assets/driving/`.
 * Tune to match files you keep alongside Comfy driving reference clips.
 */
export const DRIVING_VIDEOS = {
  angry: 'angry_power.mp4',
  laugh: 'laugh_mocking.mp4',
  confused: 'confused_ngo.mp4',
  thinking: 'deep_thinking.mp4',
  default: 'default_arrogant.mp4',
} as const;

export type DrivingVideoTag = keyof typeof DRIVING_VIDEOS;

/** Legacy script emotions (FFmpeg-only era) → driving asset for the single Comfy pass. */
const LEGACY_SCENE_EMOTION_TO_DRIVING: Record<string, DrivingVideoTag> = {
  zoom_in_fast: 'default',
  pan_left: 'confused',
  camera_shake: 'angry',
};

export function drivingTagFromSceneEmotion(emotion: string): DrivingVideoTag {
  if (emotion in DRIVING_VIDEOS) {
    return emotion as DrivingVideoTag;
  }
  return LEGACY_SCENE_EMOTION_TO_DRIVING[emotion] ?? 'default';
}

export function resolveDrivingBasename(tag: DrivingVideoTag): string {
  return DRIVING_VIDEOS[tag];
}

export function resolveDrivingAbsolutePath(
  dataRoot: string,
  tag: DrivingVideoTag,
): string {
  return path.join(dataRoot, 'assets', 'driving', DRIVING_VIDEOS[tag]);
}

/**
 * File nguồn Comfy sẽ copy vào input (giống `ComfyService` trước khi submit prompt).
 * `COMFY_DRIVING_VIDEO` ghi đè mọi emotion.
 */
export function resolveComfyDrivingSourcePath(
  dataRoot: string,
  drivingEmotion: string,
): string {
  const fromEnv = process.env.COMFY_DRIVING_VIDEO?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const root = path.resolve(dataRoot);
  const tag = drivingTagFromSceneEmotion(drivingEmotion);
  const mapped = resolveDrivingAbsolutePath(root, tag);
  if (fs.existsSync(mapped)) return mapped;

  const legacy = path.join(root, 'assets', 'driving_reference.mp4');
  if (fs.existsSync(legacy)) return legacy;

  throw new Error(
    `Driving video missing for emotion "${drivingEmotion}" → ${mapped}. ` +
      `Thêm file trong ${path.join(root, 'assets', 'driving')}/ hoặc set COMFY_DRIVING_VIDEO.`,
  );
}

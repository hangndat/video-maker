import path from 'node:path';

export type JobPaths = {
  jobRoot: string;
  inputDir: string;
  audioDir: string;
  audioVoice: string;
  /** Per-scene ElevenLabs MP3: audioDir/scene-{id}.mp3 */
  sceneVoiceMp3: (sceneId: number) => string;
  /** Saved alignment for resume (no re‑TTS): audioDir/scene-{id}.alignment.json */
  sceneAlignmentJson: (sceneId: number) => string;
  subtitlesDir: string;
  subtitlesAss: string;
  comfyDir: string;
  comfyRawVideo: string;
  /** LivePortrait output cho đúng cảnh (driving theo `emotion` cảnh đó). */
  comfySceneRawVideo: (sceneId: number) => string;
  /** FFmpeg per-scene processed clips */
  scenesDir: string;
  sceneClipMp4: (sceneId: number) => string;
  scenesConcatList: string;
  scenesConcatMp4: string;
  finalDir: string;
  finalOutput: string;
  metaFile: string;
};

function ensureDataRoot(): string {
  if (process.env.DATA_ROOT) return process.env.DATA_ROOT;
  return path.join(process.cwd(), 'shared_data');
}

/**
 * Centralizes all job paths under `/data/jobs/{jobId}` (or DATA_ROOT).
 */
export function createPathProvider(dataRoot = ensureDataRoot()) {
  const assetsRoot = () => path.join(dataRoot, 'assets');
  const jobsRoot = () => path.join(dataRoot, 'jobs');
  const finalPublishedRoot = () => path.join(dataRoot, 'final');

  const jobPaths = (jobId: string): JobPaths => {
    const jobRoot = path.join(dataRoot, 'jobs', jobId);
    const audioDir = path.join(jobRoot, 'audio');
    const subtitlesDir = path.join(jobRoot, 'subtitles');
    const comfyDir = path.join(jobRoot, 'comfy');
    const scenesDir = path.join(comfyDir, 'scenes');
    const finalDir = path.join(jobRoot, 'final');
    return {
      jobRoot,
      inputDir: path.join(jobRoot, 'input'),
      audioDir,
      audioVoice: path.join(audioDir, 'voice.mp3'),
      sceneVoiceMp3: (sceneId: number) =>
        path.join(audioDir, `scene-${sceneId}.mp3`),
      sceneAlignmentJson: (sceneId: number) =>
        path.join(audioDir, `scene-${sceneId}.alignment.json`),
      subtitlesDir,
      subtitlesAss: path.join(subtitlesDir, 'burn.ass'),
      comfyDir,
      comfyRawVideo: path.join(comfyDir, 'raw.mp4'),
      comfySceneRawVideo: (sceneId: number) =>
        path.join(scenesDir, `raw-scene-${sceneId}.mp4`),
      scenesDir,
      sceneClipMp4: (sceneId: number) =>
        path.join(scenesDir, `clip-${sceneId}.mp4`),
      scenesConcatList: path.join(scenesDir, 'concat.txt'),
      scenesConcatMp4: path.join(scenesDir, 'concat.mp4'),
      finalDir,
      finalOutput: path.join(finalDir, 'output.mp4'),
      metaFile: path.join(jobRoot, 'meta.json'),
    };
  };

  return {
    dataRoot,
    assetsRoot,
    jobsRoot,
    finalPublishedRoot,
    jobPaths,
    masterFace: () => path.join(assetsRoot(), 'Master_Face.png'),
    drivingVideosDir: () => path.join(assetsRoot(), 'Driving_Videos'),
  };
}

export type PathProvider = ReturnType<typeof createPathProvider>;

import path from 'node:path';

export type JobPaths = {
  jobRoot: string;
  inputDir: string;
  audioDir: string;
  audioVoice: string;
  sceneVoiceMp3: (sceneId: number) => string;
  sceneAlignmentJson: (sceneId: number) => string;
  subtitlesDir: string;
  subtitlesAss: string;
  /** B-roll staging: `media/scenes/source-{id}.mp4` */
  mediaDir: string;
  mediaRawVideo: string;
  mediaSceneSource: (sceneId: number) => string;
  scenesDir: string;
  sceneClipMp4: (sceneId: number) => string;
  scenesConcatList: string;
  scenesConcatMp4: string;
  finalDir: string;
  finalOutput: string;
  metaFile: string;
  declarativeDir: string;
  declarativeSnapshot: string;
};

function ensureDataRoot(): string {
  if (process.env.DATA_ROOT) return process.env.DATA_ROOT;
  return path.join(process.cwd(), 'shared_data');
}

/**
 * Centralizes all job paths under `DATA_ROOT/jobs/{jobId}`.
 */
export function createPathProvider(dataRoot = ensureDataRoot()) {
  const assetsRoot = () => path.join(dataRoot, 'assets');
  const jobsRoot = () => path.join(dataRoot, 'jobs');
  const finalPublishedRoot = () => path.join(dataRoot, 'final');
  const profilesRoot = () => path.join(dataRoot, 'profiles');

  const jobPaths = (jobId: string): JobPaths => {
    const jobRoot = path.join(dataRoot, 'jobs', jobId);
    const audioDir = path.join(jobRoot, 'audio');
    const subtitlesDir = path.join(jobRoot, 'subtitles');
    const mediaDir = path.join(jobRoot, 'media');
    const scenesDir = path.join(mediaDir, 'scenes');
    const finalDir = path.join(jobRoot, 'final');
    const declarativeDir = path.join(jobRoot, 'declarative');
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
      mediaDir,
      mediaRawVideo: path.join(mediaDir, 'raw.mp4'),
      mediaSceneSource: (sceneId: number) =>
        path.join(scenesDir, `source-${sceneId}.mp4`),
      scenesDir,
      sceneClipMp4: (sceneId: number) =>
        path.join(scenesDir, `clip-${sceneId}.mp4`),
      scenesConcatList: path.join(scenesDir, 'concat.txt'),
      scenesConcatMp4: path.join(scenesDir, 'concat.mp4'),
      finalDir,
      finalOutput: path.join(finalDir, 'output.mp4'),
      metaFile: path.join(jobRoot, 'meta.json'),
      declarativeDir,
      declarativeSnapshot: path.join(declarativeDir, 'snapshot.json'),
    };
  };

  return {
    dataRoot,
    assetsRoot,
    jobsRoot,
    finalPublishedRoot,
    profilesRoot,
    jobPaths,
  };
}

export type PathProvider = ReturnType<typeof createPathProvider>;

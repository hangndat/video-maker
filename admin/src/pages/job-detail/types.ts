export type ArtifactRow = { rel: string; size: number; contentType?: string };

export type PipelineAction =
  | 'tts_resume'
  | 'from_video_ingest'
  | 'from_video_reuse'
  | 'from_video_assemble';

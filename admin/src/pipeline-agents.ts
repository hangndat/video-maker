export type ArtifactOutputKind = 'video' | 'audio' | 'json' | 'text';

export type AgentArtifactRef = {
  rel: string;
  label: string;
  kind: ArtifactOutputKind;
};

export type AgentStage = {
  id: string;
  title: string;
  summary: string;
  inputsJson: unknown;
  artifacts: AgentArtifactRef[];
};

function asRecord(m: unknown): Record<string, unknown> | null {
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    return m as Record<string, unknown>;
  }
  return null;
}

function sceneIdsFromMeta(meta: Record<string, unknown> | null): number[] {
  const script = meta?.script;
  if (!script || typeof script !== 'object') return [];
  const scenes = (script as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes)) return [];
  return scenes
    .map((s) =>
      s && typeof s === 'object' ? (s as { id?: unknown }).id : undefined,
    )
    .filter((id): id is number => typeof id === 'number');
}

function has(set: Set<string>, rel: string): boolean {
  return set.has(rel);
}

/** Bước pipeline / “agent” — input (từ meta) và output (file trên disk). */
export function buildAgentStages(
  meta: unknown,
  artifactRels: Set<string>,
): AgentStage[] {
  const m = asRecord(meta);
  const ids = sceneIdsFromMeta(m);
  const scriptBlock = m?.script;

  const stages: AgentStage[] = [];

  const configInputs = m
    ? {
        profileId: m.profileId,
        presetPath: m.presetPath,
        presetContentSha256: m.presetContentSha256,
        tuning: m.tuning,
        effectiveRenderConfig: m.effectiveRenderConfig,
      }
    : { note: 'Chưa có meta' };

  const configArts: AgentArtifactRef[] = [];
  if (has(artifactRels, 'meta.json')) {
    configArts.push({ rel: 'meta.json', label: 'meta.json', kind: 'json' });
  }
  if (has(artifactRels, 'declarative/snapshot.json')) {
    configArts.push({
      rel: 'declarative/snapshot.json',
      label: 'declarative/snapshot.json',
      kind: 'json',
    });
  }
  stages.push({
    id: 'config',
    title: '0 — Profile & render config',
    summary: 'Merge preset, env, tuning → effectiveRenderConfig (resolveRenderConfig).',
    inputsJson: configInputs,
    artifacts: configArts,
  });

  stages.push({
    id: 'script',
    title: '1 — Script (OpenAI hoặc preset scenes)',
    summary: 'Sinh hoặc nhận scenes: id, text, motion, videoPath, sfxKey, …',
    inputsJson: m ? { idea: m.idea, script: scriptBlock } : {},
    artifacts: [],
  });

  const ttsArts: AgentArtifactRef[] = [];
  if (has(artifactRels, 'audio/voice.mp3')) {
    ttsArts.push({
      rel: 'audio/voice.mp3',
      label: 'Giọng full (voice.mp3)',
      kind: 'audio',
    });
  }
  for (const id of ids) {
    const mp3 = `audio/scene-${id}.mp3`;
    if (has(artifactRels, mp3)) {
      ttsArts.push({ rel: mp3, label: `TTS cảnh ${id}`, kind: 'audio' });
    }
    const al = `audio/scene-${id}.alignment.json`;
    if (has(artifactRels, al)) {
      ttsArts.push({
        rel: al,
        label: `Alignment cảnh ${id}`,
        kind: 'json',
      });
    }
  }
  stages.push({
    id: 'tts',
    title: '2 — ElevenLabs TTS',
    summary: 'Full voice + per-scene mp3 và alignment JSON.',
    inputsJson: m
      ? {
          voice: m.voice,
          scriptSummary: {
            duration_estimate: (scriptBlock as { duration_estimate?: unknown } | undefined)
              ?.duration_estimate,
            sceneCount: ids.length,
          },
        }
      : {},
    artifacts: ttsArts,
  });

  const brollArts: AgentArtifactRef[] = [];
  for (const id of ids) {
    const rel = `media/scenes/source-${id}.mp4`;
    if (has(artifactRels, rel)) {
      brollArts.push({
        rel,
        label: `Nguồn B-roll cảnh ${id}`,
        kind: 'video',
      });
    }
  }
  stages.push({
    id: 'broll',
    title: '3 — Ingest B-roll',
    summary: 'Đưa nguồn vào media/scenes/source-*.mp4.',
    inputsJson: m
      ? {
          media: m.media,
          scenes: (scriptBlock as { scenes?: unknown } | undefined)?.scenes,
        }
      : {},
    artifacts: brollArts,
  });

  const clipArts: AgentArtifactRef[] = [];
  for (const id of ids) {
    const rel = `media/scenes/clip-${id}.mp4`;
    if (has(artifactRels, rel)) {
      clipArts.push({ rel, label: `Clip cảnh ${id}`, kind: 'video' });
    }
  }
  stages.push({
    id: 'scene_ffmpeg',
    title: '4 — FFmpeg từng cảnh',
    summary: 'Motion + segmentVideoMode → clip-*.mp4.',
    inputsJson: { hint: 'Thuộc tính motion từng cảnh: meta.script.scenes[].motion' },
    artifacts: clipArts,
  });

  const concatArts: AgentArtifactRef[] = [];
  if (has(artifactRels, 'media/scenes/concat.mp4')) {
    concatArts.push({
      rel: 'media/scenes/concat.mp4',
      label: 'concat.mp4',
      kind: 'video',
    });
  }
  if (has(artifactRels, 'media/scenes/concat.txt')) {
    concatArts.push({
      rel: 'media/scenes/concat.txt',
      label: 'concat.txt',
      kind: 'text',
    });
  }
  if (has(artifactRels, 'media/raw.mp4')) {
    concatArts.push({
      rel: 'media/raw.mp4',
      label: 'media/raw.mp4',
      kind: 'video',
    });
  }
  stages.push({
    id: 'concat',
    title: '5 — Ghép cảnh',
    summary: 'Nối clip → concat.mp4.',
    inputsJson: {},
    artifacts: concatArts,
  });

  const finalArts: AgentArtifactRef[] = [];
  if (has(artifactRels, 'subtitles/burn.ass')) {
    finalArts.push({
      rel: 'subtitles/burn.ass',
      label: 'Phụ đề burn.ass',
      kind: 'text',
    });
  }
  if (has(artifactRels, 'final/output.mp4')) {
    finalArts.push({
      rel: 'final/output.mp4',
      label: 'final/output.mp4',
      kind: 'video',
    });
  }
  stages.push({
    id: 'final',
    title: '6 — Final mux',
    summary: 'ASS + BGM + SFX + ducking → final/output.mp4.',
    inputsJson: m
      ? {
          audioPreset: (m.effectiveRenderConfig as { audio?: unknown } | undefined)?.audio,
        }
      : {},
    artifacts: finalArts,
  });

  return stages;
}

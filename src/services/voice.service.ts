import fs from 'node:fs';
import path from 'node:path';
import { startActiveObservation } from '@langfuse/tracing';
import type { CharacterAlignment } from '../types/elevenlabs.js';
import { characterAlignmentSchema } from '../types/elevenlabs.js';
import { audioWithTimestampsResponseSchema } from '../types/elevenlabs-response.js';
import { ffprobeDurationSec } from '../shared/ffprobe.js';
import { pipelineLog } from '../shared/pipeline-log.js';

export type VoiceSynthesisResult = {
  audioPath: string;
  actualDurationSec: number;
  alignment: CharacterAlignment;
  normalizedAlignment?: CharacterAlignment;
};

export type SynthesizeTtsOptions = {
  kind: 'full' | 'scene';
  sceneId?: number;
};

function ttsInputForTrace(text: string): string | { charCount: number } {
  if (process.env.LANGFUSE_LOG_TTS_TEXT === '1') return text;
  return { charCount: text.length };
}

/** Ước lượng USD cho Langfuse; ElevenLabs không trả cost trong API — tự set theo bảng giá của bạn. */
function elevenLabsEstimatedUsd(inputCharCount: number): number | undefined {
  const raw =
    process.env.LANGFUSE_ELEVENLABS_USD_PER_1K_CHARS?.trim() ??
    process.env.ELEVENLABS_LANGFUSE_USD_PER_1K_CHARS?.trim();
  if (!raw) return undefined;
  const per1k = Number(raw);
  if (!Number.isFinite(per1k) || per1k < 0) return undefined;
  const usd = (inputCharCount / 1000) * per1k;
  return Math.round(usd * 1e6) / 1e6;
}

export class VoiceService {
  async synthesizeWithTimestamps(
    text: string,
    audioOutPath: string,
    traceOpts?: SynthesizeTtsOptions,
  ): Promise<VoiceSynthesisResult> {
    return startActiveObservation(
      'elevenlabs.tts',
      async (observation) => {
        const key = process.env.ELEVENLABS_API_KEY;
        const voiceId = process.env.ELEVENLABS_VOICE_ID;
        if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
        if (!voiceId) throw new Error('ELEVENLABS_VOICE_ID is not set');

        const modelId =
          process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
        pipelineLog('agent.elevenlabs.tts.start', {
          kind: traceOpts?.kind ?? 'full',
          sceneId: traceOpts?.sceneId,
          charCount: text.length,
          modelId,
          audioFile: path.basename(audioOutPath),
        });
        const outputFormat =
          process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'mp3_44100_128';

        observation.otelSpan.setAttributes({
          'gen_ai.system': 'elevenlabs',
          'gen_ai.operation.name': 'text_to_speech',
          'gen_ai.request.model': modelId,
        });

        const meta: Record<string, string> = {
          voiceId: voiceId.slice(0, 200),
        };
        if (traceOpts?.kind) meta.kind = traceOpts.kind;
        if (traceOpts?.sceneId != null) meta.sceneId = String(traceOpts.sceneId);

        observation.update({
          model: modelId,
          input: ttsInputForTrace(text),
          metadata: meta,
        });

        const url = new URL(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
        );
        url.searchParams.set('output_format', outputFormat);

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': key,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          observation.update({
            level: 'ERROR',
            statusMessage: `HTTP ${res.status}`,
            output: { errorPreview: errBody.slice(0, 500) },
          });
          throw new Error(`ElevenLabs ${res.status}: ${errBody.slice(0, 500)}`);
        }

        const json: unknown = await res.json();
        const parsed = audioWithTimestampsResponseSchema.parse(json);

        const alignment =
          parsed.normalized_alignment ?? parsed.alignment;
        if (!alignment) {
          throw new Error('ElevenLabs response missing alignment data');
        }
        characterAlignmentSchema.parse(alignment);

        await fs.promises.mkdir(path.dirname(audioOutPath), {
          recursive: true,
        });
        const buf = Buffer.from(parsed.audio_base64, 'base64');
        await fs.promises.writeFile(audioOutPath, buf);

        let actualDurationSec: number;
        try {
          actualDurationSec = await ffprobeDurationSec(audioOutPath);
        } catch {
          const ends = alignment.character_end_times_seconds;
          actualDurationSec = ends.length > 0 ? Math.max(...ends) : 0;
        }

        const estUsd = elevenLabsEstimatedUsd(text.length);
        // Langfuse: cost_details.total/input (USD). OTEL ingest also reads gen_ai.usage.cost as { total }.
        const costDetailsPayload =
          estUsd != null
            ? { total: estUsd, input: estUsd }
            : undefined;
        if (estUsd != null) {
          observation.otelSpan.setAttribute('gen_ai.usage.cost', estUsd);
        }
        observation.update({
          output: {
            audioPath: audioOutPath,
            actualDurationSec,
            hasNormalizedAlignment: Boolean(parsed.normalized_alignment),
          },
          usageDetails: { input: text.length },
          ...(costDetailsPayload ? { costDetails: costDetailsPayload } : {}),
        });

        pipelineLog('agent.elevenlabs.tts.complete', {
          kind: traceOpts?.kind ?? 'full',
          sceneId: traceOpts?.sceneId,
          actualDurationSec,
          audioFile: path.basename(audioOutPath),
          hasNormalizedAlignment: Boolean(parsed.normalized_alignment),
        });

        return {
          audioPath: audioOutPath,
          actualDurationSec,
          alignment,
          normalizedAlignment: parsed.normalized_alignment,
        };
      },
      { asType: 'generation' },
    );
  }
}

export const voiceService = new VoiceService();
